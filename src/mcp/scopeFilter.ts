import type { Memories, Memory, NewMemory, RecallHit } from '../core/memories/index.js';
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

export class ScopeFilter {
  constructor(
    private readonly tool: ToolWithGrants,
    private readonly memories: Memories
  ) {}

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
}
