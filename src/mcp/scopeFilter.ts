import type { Memories, Memory, NewMemory, RecallHit } from '../core/memories/index.js';
import type {
  Documents,
  DocumentChunkHit,
  IngestInput,
  IngestResult,
} from '../core/documents/index.js';
import type {
  Workspace,
  WorkspaceItem,
  Workspaces,
  NewWorkspaceItem,
} from '../core/workspace/index.js';
import type {
  Conversations,
  HistoryHit,
  HistorySearchOptions,
} from '../core/conversations/index.js';
import type { ToolGrant, ToolWithGrants } from '../core/tools/index.js';
import { ScopeDeniedError } from '../core/errors.js';
import { RECALL_OVERFETCH_RATIO } from '../core/constants.js';

/**
 * Security boundary between MCP callers and the domain modules.
 *
 * Every MCP tool call passes through a method here. Each method applies
 * one of two policies:
 *
 *   READ:  results are filtered to scopes the calling tool can read.
 *          An explicit unreadable scope throws ScopeDeniedError.
 *          Zero readable scopes → empty result (never an error).
 *   WRITE: the target scope must be writable. Unscoped writes default
 *          to the tool's first writable scope; no writable scopes at
 *          all → ScopeDeniedError.
 *
 * `forget` is intentionally silent across scope boundaries (returns
 * `false` instead of throwing) so tools can't enumerate ids in scopes
 * they aren't granted.
 *
 * The raw domain APIs are deliberately unscoped — the admin CLI uses
 * them directly. The MCP layer must never bypass this filter.
 */
export { ScopeDeniedError };

export interface FilterDeps {
  memories: Memories;
  documents: Documents;
  workspaces: Workspaces;
  conversations: Conversations;
}

export class ScopeFilter {
  private readonly memories: Memories;
  private readonly documents: Documents;
  private readonly workspaces: Workspaces;
  private readonly conversations: Conversations;

  constructor(private readonly tool: ToolWithGrants, deps: FilterDeps) {
    this.memories = deps.memories;
    this.documents = deps.documents;
    this.workspaces = deps.workspaces;
    this.conversations = deps.conversations;
  }

  // ---------- caller identity ----------

  get caller(): ToolWithGrants {
    return this.tool;
  }

  get callerName(): string {
    return this.tool.name;
  }

  // ---------- grant queries ----------

  readableScopes(): readonly string[] {
    return this.tool.grants.filter((g) => g.canRead).map((g) => g.scope);
  }

  writableScopes(): readonly string[] {
    return this.tool.grants.filter((g) => g.canWrite).map((g) => g.scope);
  }

  hasReadAccess(scope: string): boolean {
    return this.findGrant(scope)?.canRead ?? false;
  }

  hasWriteAccess(scope: string): boolean {
    return this.findGrant(scope)?.canWrite ?? false;
  }

  // ---------- memories ----------

  async remember(input: NewMemory): Promise<Memory> {
    const scope = this.requireWritableScope(input.scope);
    return this.memories.remember({ ...input, scope });
  }

  async recall(query: string, opts: { limit?: number; scope?: string } = {}): Promise<RecallHit[]> {
    if (opts.scope !== undefined) {
      this.requireReadableScope(opts.scope);
      return this.memories.recall(query, {
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        scope: opts.scope,
      });
    }
    return this.filterReadableHits(
      await this.memories.recall(query, { limit: (opts.limit ?? 10) * RECALL_OVERFETCH_RATIO }),
      (h) => h.memory.scope,
      opts.limit ?? 10
    );
  }

  forget(id: number): boolean {
    const memory = this.safeGetMemory(id);
    if (!memory || memory.scope === null || !this.hasWriteAccess(memory.scope)) {
      // Intentionally collapse all "cannot delete" cases to the same
      // signal — do not distinguish "not found" from "not yours".
      return false;
    }
    return this.memories.forget(id);
  }

  // ---------- documents ----------

  async ingestDocument(input: IngestInput): Promise<IngestResult> {
    const scope = this.requireWritableScope(input.scope);
    return this.documents.ingest({ ...input, scope });
  }

  async searchDocuments(
    query: string,
    opts: { limit?: number; scope?: string } = {}
  ): Promise<DocumentChunkHit[]> {
    if (opts.scope !== undefined) {
      this.requireReadableScope(opts.scope);
      return this.documents.search(query, {
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        scope: opts.scope,
      });
    }
    return this.filterReadableHits(
      await this.documents.search(query, { limit: (opts.limit ?? 10) * RECALL_OVERFETCH_RATIO }),
      (h) => h.scope,
      opts.limit ?? 10
    );
  }

  // ---------- conversation history ----------

  async searchHistory(query: string, opts: HistorySearchOptions = {}): Promise<HistoryHit[]> {
    if (opts.scope !== undefined) {
      this.requireReadableScope(opts.scope);
      return this.conversations.search(query, opts);
    }
    return this.filterReadableHits(
      await this.conversations.search(query, { ...opts, limit: (opts.limit ?? 10) * RECALL_OVERFETCH_RATIO }),
      (h) => h.scope,
      opts.limit ?? 10
    );
  }

  // ---------- workspaces ----------

  listWorkspaces(): Workspace[] {
    const readable = new Set(this.readableScopes());
    if (readable.size === 0) return [];
    return this.workspaces.list().filter((w) => w.scope !== null && readable.has(w.scope));
  }

  getActiveWorkspace(): Workspace | null {
    const readable = new Set(this.readableScopes());
    const active = this.workspaces.getActive();
    if (!active || active.scope === null || !readable.has(active.scope)) return null;
    return active;
  }

  addToWorkspace(item: NewWorkspaceItem & { workspaceId?: number }): WorkspaceItem {
    const target = this.workspaces.resolveTarget(item.workspaceId);
    if (!target) throw new ScopeDeniedError('no workspace specified and no active workspace set', 'write', '(none)');
    if (target.scope === null || !this.hasWriteAccess(target.scope)) {
      throw new ScopeDeniedError(
        `tool '${this.tool.name}' cannot write workspace '${target.name}' (scope '${target.scope ?? '-'}')`,
        'write',
        target.scope ?? '(none)'
      );
    }
    return this.workspaces.addItem(target.id, {
      kind: item.kind,
      content: item.content,
      ...(item.state ? { state: item.state } : {}),
    });
  }

  // ---------- internals ----------

  private findGrant(scope: string): ToolGrant | undefined {
    return this.tool.grants.find((g) => g.scope === scope);
  }

  private requireWritableScope(requested: string | undefined): string {
    const scope = requested ?? this.writableScopes()[0];
    if (!scope) {
      throw new ScopeDeniedError(
        `tool '${this.tool.name}' has no writable scopes`,
        'write',
        '(none)'
      );
    }
    if (!this.hasWriteAccess(scope)) {
      throw new ScopeDeniedError(
        `tool '${this.tool.name}' cannot write to scope '${scope}'`,
        'write',
        scope
      );
    }
    return scope;
  }

  private requireReadableScope(scope: string): void {
    if (!this.hasReadAccess(scope)) {
      throw new ScopeDeniedError(
        `tool '${this.tool.name}' cannot read scope '${scope}'`,
        'read',
        scope
      );
    }
  }

  private filterReadableHits<T>(
    hits: T[],
    getScope: (h: T) => string | null,
    limit: number
  ): T[] {
    const readable = new Set(this.readableScopes());
    if (readable.size === 0) return [];
    const filtered: T[] = [];
    for (const h of hits) {
      const s = getScope(h);
      if (s !== null && readable.has(s)) filtered.push(h);
      if (filtered.length >= limit) break;
    }
    return filtered;
  }

  private safeGetMemory(id: number): Memory | null {
    try {
      return this.memories.getById(id);
    } catch {
      return null;
    }
  }
}
