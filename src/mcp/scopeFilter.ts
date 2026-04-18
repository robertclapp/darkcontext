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

/**
 * Security boundary. Every MCP tool call flows through this filter — it is the
 * ONLY layer that decides whether a given calling tool may read or write a
 * given scope. The underlying `Memories` API is deliberately unscoped so the
 * admin CLI can operate without auth; MCP must never bypass this filter.
 *
 * Rules:
 *   - A tool may remember into a scope iff it has canWrite on that scope.
 *   - A tool may forget a memory iff it has canWrite on that memory's scope.
 *   - A tool may recall across scopes iff it has canRead on them; results are
 *     filtered server-side, never leaked by count, id, or error.
 *   - If no readable scopes, recall returns an empty array (not an error).
 *   - If caller omits a scope on remember, we default to the tool's first
 *     writable scope; if none, we reject.
 */

export class ScopeDeniedError extends Error {
  constructor(
    message: string,
    public readonly kind: 'read' | 'write',
    public readonly scope: string
  ) {
    super(message);
    this.name = 'ScopeDeniedError';
  }
}

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

  constructor(
    private readonly tool: ToolWithGrants,
    deps: FilterDeps
  ) {
    this.memories = deps.memories;
    this.documents = deps.documents;
    this.workspaces = deps.workspaces;
    this.conversations = deps.conversations;
  }

  /**
   * Return the tool identity this filter was constructed with. Exposed so
   * callers (server bootstrap, tests) don't need to thread the tool through
   * a second parameter and can avoid reaching into private state.
   */
  get caller(): ToolWithGrants {
    return this.tool;
  }

  get callerName(): string {
    return this.tool.name;
  }

  readableScopes(): string[] {
    return this.tool.grants.filter((g) => g.canRead).map((g) => g.scope);
  }

  writableScopes(): string[] {
    return this.tool.grants.filter((g) => g.canWrite).map((g) => g.scope);
  }

  canRead(scope: string): boolean {
    return this.findGrant(scope)?.canRead ?? false;
  }

  canWrite(scope: string): boolean {
    return this.findGrant(scope)?.canWrite ?? false;
  }

  async remember(input: NewMemory): Promise<Memory> {
    const scope = input.scope ?? this.defaultWritableScope();
    if (!scope) {
      throw new ScopeDeniedError(
        `tool '${this.tool.name}' has no writable scopes`,
        'write',
        '(none)'
      );
    }
    if (!this.canWrite(scope)) {
      throw new ScopeDeniedError(
        `tool '${this.tool.name}' cannot write to scope '${scope}'`,
        'write',
        scope
      );
    }
    return this.memories.remember({ ...input, scope });
  }

  async recall(
    query: string,
    opts: { limit?: number; scope?: string } = {}
  ): Promise<RecallHit[]> {
    const readable = new Set(this.readableScopes());
    if (readable.size === 0) return [];

    if (opts.scope !== undefined) {
      if (!readable.has(opts.scope)) {
        throw new ScopeDeniedError(
          `tool '${this.tool.name}' cannot read scope '${opts.scope}'`,
          'read',
          opts.scope
        );
      }
      return this.memories.recall(query, {
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        scope: opts.scope,
      });
    }

    // No scope specified: query unscoped, then filter to readable scopes.
    // Over-fetch to compensate for filtering so we still return `limit` hits
    // in the common case.
    const limit = opts.limit ?? 10;
    const rawHits = await this.memories.recall(query, { limit: limit * 4 });
    const filtered = rawHits.filter((h) => h.memory.scope !== null && readable.has(h.memory.scope));
    return filtered.slice(0, limit);
  }

  forget(id: number): boolean {
    const memory = this.safeGet(id);
    if (!memory) return false;

    if (memory.scope === null || !this.canWrite(memory.scope)) {
      // Do not leak existence — report "not found" rather than a permission error.
      return false;
    }
    return this.memories.forget(id);
  }

  private findGrant(scope: string): ToolGrant | undefined {
    return this.tool.grants.find((g) => g.scope === scope);
  }

  private defaultWritableScope(): string | undefined {
    return this.writableScopes()[0];
  }

  private safeGet(id: number): Memory | null {
    try {
      return this.memories.getById(id);
    } catch {
      return null;
    }
  }

  // ---------- Documents ----------

  async ingestDocument(input: IngestInput): Promise<IngestResult> {
    const scope = input.scope ?? this.defaultWritableScope();
    if (!scope) {
      throw new ScopeDeniedError(
        `tool '${this.tool.name}' has no writable scopes`,
        'write',
        '(none)'
      );
    }
    if (!this.canWrite(scope)) {
      throw new ScopeDeniedError(
        `tool '${this.tool.name}' cannot write to scope '${scope}'`,
        'write',
        scope
      );
    }
    return this.documents.ingest({ ...input, scope });
  }

  async searchDocuments(
    query: string,
    opts: { limit?: number; scope?: string } = {}
  ): Promise<DocumentChunkHit[]> {
    const readable = new Set(this.readableScopes());
    if (readable.size === 0) return [];

    if (opts.scope !== undefined) {
      if (!readable.has(opts.scope)) {
        throw new ScopeDeniedError(
          `tool '${this.tool.name}' cannot read scope '${opts.scope}'`,
          'read',
          opts.scope
        );
      }
      return this.documents.search(query, {
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        scope: opts.scope,
      });
    }

    const limit = opts.limit ?? 10;
    const raw = await this.documents.search(query, { limit: limit * 4 });
    return raw.filter((h) => h.scope !== null && readable.has(h.scope)).slice(0, limit);
  }

  // ---------- Workspaces ----------

  listWorkspaces(): Workspace[] {
    const readable = new Set(this.readableScopes());
    if (readable.size === 0) return [];
    return this.workspaces
      .list()
      .filter((w) => w.scope !== null && readable.has(w.scope));
  }

  getActiveWorkspace(): Workspace | null {
    const readable = new Set(this.readableScopes());
    const active = this.workspaces.getActive();
    if (!active) return null;
    if (active.scope === null || !readable.has(active.scope)) return null;
    return active;
  }

  // ---------- Conversation history ----------

  async searchHistory(
    query: string,
    opts: HistorySearchOptions = {}
  ): Promise<HistoryHit[]> {
    const readable = new Set(this.readableScopes());
    if (readable.size === 0) return [];

    if (opts.scope !== undefined) {
      if (!readable.has(opts.scope)) {
        throw new ScopeDeniedError(
          `tool '${this.tool.name}' cannot read scope '${opts.scope}'`,
          'read',
          opts.scope
        );
      }
      return this.conversations.search(query, opts);
    }

    const limit = opts.limit ?? 10;
    const raw = await this.conversations.search(query, { ...opts, limit: limit * 4 });
    return raw.filter((h) => h.scope !== null && readable.has(h.scope)).slice(0, limit);
  }

  addToWorkspace(item: NewWorkspaceItem & { workspaceId?: number }): WorkspaceItem {
    // Target resolution (explicit id vs. active) is a workspace concern;
    // the filter only decides whether the calling tool may write to it.
    const target = this.workspaces.resolveTarget(item.workspaceId);
    if (!target) throw new Error('no workspace specified and no active workspace set');
    if (target.scope === null || !this.canWrite(target.scope)) {
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
}
