import type { DarkContextDb } from '../store/db.js';
import type { Memories } from '../memories/index.js';
import type { Documents } from '../documents/index.js';
import type { Conversations } from '../conversations/index.js';
import { NotFoundError, ValidationError } from '../errors.js';

/**
 * Per-scope retention: after `retention_days`, content in that scope is
 * dropped by an explicit `dcx prune` run. Opt-in — scopes with no row in
 * `scope_retention` keep data forever.
 *
 * Retention is a **policy**, not a trigger. Nothing is deleted on write;
 * operators run `prune()` on their own schedule (cron, systemd timer,
 * CI job). This keeps the hot write path unchanged and makes the "what
 * was about to expire?" question answerable via `--dry-run` before any
 * row is gone.
 *
 * Pruned tables: `memories`, `documents`, `conversations`,
 * `workspace_items`. Workspaces themselves are NOT pruned — they are
 * long-lived containers that hold the (now-expired) items. Audit log is
 * NOT pruned here — use `dcx audit prune` with an explicit cutoff.
 */

export interface RetentionRule {
  scope: string;
  days: number;
}

export interface PruneOptions {
  /** Restrict the sweep to a single scope. Omit = every scope with a rule. */
  scope?: string;
  /** Count what would be deleted without actually deleting. */
  dryRun?: boolean;
  /** Override "now" for deterministic tests. Defaults to Date.now(). */
  now?: number;
}

export interface PrunedCounts {
  memories: number;
  documents: number;
  conversations: number;
  workspaceItems: number;
}

export interface ScopeResult {
  scope: string;
  days: number;
  cutoff: number;
  counts: PrunedCounts;
}

export interface PruneResult {
  dryRun: boolean;
  scanned: number;
  total: PrunedCounts;
  scopes: ScopeResult[];
}

const MS_PER_DAY = 86_400_000;

export class Retention {
  constructor(
    private readonly db: DarkContextDb,
    private readonly memories: Memories,
    private readonly documents: Documents,
    private readonly conversations: Conversations
  ) {}

  /**
   * Set or update the retention rule for `scope`. Creates the scope row
   * implicitly — same policy as every other write path in the project
   * (see `resolveScopeOrDefault`).
   */
  set(scope: string, days: number): RetentionRule {
    if (!Number.isInteger(days) || days <= 0) {
      throw new ValidationError(
        'days',
        `retention days must be a positive integer, got ${days}`
      );
    }
    const scopeRow = this.resolveScope(scope, { create: true });
    if (!scopeRow) throw new Error(`unreachable: resolveScope({create:true}) returned null for '${scope}'`);
    const now = Date.now();
    this.db.raw
      .prepare(
        `INSERT INTO scope_retention (scope_id, retention_days, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(scope_id) DO UPDATE SET
           retention_days = excluded.retention_days,
           updated_at     = excluded.updated_at`
      )
      .run(scopeRow.id, days, now);
    return { scope: scopeRow.name, days };
  }

  /** Remove the retention rule for `scope`. Returns true if one existed. */
  clear(scope: string): boolean {
    const scopeRow = this.resolveScope(scope, { create: false });
    if (!scopeRow) return false;
    const res = this.db.raw
      .prepare('DELETE FROM scope_retention WHERE scope_id = ?')
      .run(scopeRow.id);
    return res.changes > 0;
  }

  /** Current rule for `scope`, or null. */
  get(scope: string): RetentionRule | null {
    const row = this.db.raw
      .prepare(
        `SELECT s.name AS scope, r.retention_days AS days
         FROM scope_retention r
         JOIN scopes s ON s.id = r.scope_id
         WHERE s.name = ?`
      )
      .get(scope) as RetentionRule | undefined;
    return row ?? null;
  }

  /** Every configured retention rule, sorted by scope name. */
  list(): RetentionRule[] {
    return this.db.raw
      .prepare(
        `SELECT s.name AS scope, r.retention_days AS days
         FROM scope_retention r
         JOIN scopes s ON s.id = r.scope_id
         ORDER BY s.name`
      )
      .all() as RetentionRule[];
  }

  /**
   * Sweep every scope with a retention rule (or just `opts.scope` if set)
   * and remove content older than `now - retention_days*MS_PER_DAY`.
   * Returns a breakdown per scope plus totals. Pass `dryRun: true` to
   * return the counts that *would* be deleted without deleting anything.
   */
  prune(opts: PruneOptions = {}): PruneResult {
    const now = opts.now ?? Date.now();
    const rules = opts.scope
      ? (() => {
          const r = this.get(opts.scope!);
          if (!r) {
            throw new NotFoundError('scope_retention', opts.scope!);
          }
          return [r];
        })()
      : this.list();

    const result: PruneResult = {
      dryRun: !!opts.dryRun,
      scanned: rules.length,
      total: { memories: 0, documents: 0, conversations: 0, workspaceItems: 0 },
      scopes: [],
    };

    for (const rule of rules) {
      const cutoff = now - rule.days * MS_PER_DAY;
      const counts = this.pruneScope(rule.scope, cutoff, opts.dryRun === true);
      result.scopes.push({ scope: rule.scope, days: rule.days, cutoff, counts });
      result.total.memories += counts.memories;
      result.total.documents += counts.documents;
      result.total.conversations += counts.conversations;
      result.total.workspaceItems += counts.workspaceItems;
    }
    return result;
  }

  // ---------- internals ----------

  private pruneScope(scope: string, cutoff: number, dryRun: boolean): PrunedCounts {
    const scopeRow = this.resolveScope(scope, { create: false });
    if (!scopeRow) {
      return { memories: 0, documents: 0, conversations: 0, workspaceItems: 0 };
    }

    const memoryIds = this.db.raw
      .prepare(
        'SELECT id FROM memories WHERE scope_id = ? AND created_at < ?'
      )
      .all(scopeRow.id, cutoff) as { id: number }[];

    const documentIds = this.db.raw
      .prepare(
        'SELECT id FROM documents WHERE scope_id = ? AND ingested_at < ?'
      )
      .all(scopeRow.id, cutoff) as { id: number }[];

    const conversationIds = this.db.raw
      .prepare(
        'SELECT id FROM conversations WHERE scope_id = ? AND started_at < ?'
      )
      .all(scopeRow.id, cutoff) as { id: number }[];

    // Workspace items: `updated_at` is the truth. Items live under workspaces
    // scoped elsewhere, so we filter by the owning workspace's scope_id.
    const workspaceItemIds = this.db.raw
      .prepare(
        `SELECT wi.id FROM workspace_items wi
         JOIN workspaces w ON w.id = wi.workspace_id
         WHERE w.scope_id = ? AND wi.updated_at < ?`
      )
      .all(scopeRow.id, cutoff) as { id: number }[];

    const counts: PrunedCounts = {
      memories: memoryIds.length,
      documents: documentIds.length,
      conversations: conversationIds.length,
      workspaceItems: workspaceItemIds.length,
    };

    if (!dryRun) {
      // Route deletes through the domain modules so sqlite-vec rows are
      // cleaned up alongside SQL rows. FTS rows are handled by triggers.
      for (const { id } of memoryIds) this.memories.forget(id);
      for (const { id } of documentIds) this.documents.delete(id);
      for (const { id } of conversationIds) this.conversations.delete(id);
      if (workspaceItemIds.length > 0) {
        const del = this.db.raw.prepare('DELETE FROM workspace_items WHERE id = ?');
        const tx = this.db.raw.transaction((ids: number[]) => {
          for (const id of ids) del.run(id);
        });
        tx(workspaceItemIds.map((r) => r.id));
      }
    }

    return counts;
  }

  private resolveScope(
    name: string,
    opts: { create: boolean }
  ): { id: number; name: string } | null {
    const existing = this.db.raw
      .prepare('SELECT id, name FROM scopes WHERE name = ?')
      .get(name) as { id: number; name: string } | undefined;
    if (existing) return existing;
    if (!opts.create) return null;
    this.db.raw.prepare('INSERT INTO scopes (name) VALUES (?)').run(name);
    return this.db.raw
      .prepare('SELECT id, name FROM scopes WHERE name = ?')
      .get(name) as { id: number; name: string };
  }
}
