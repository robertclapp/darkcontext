import type Database from 'better-sqlite3';

/**
 * Per-connection prepared-statement cache.
 *
 * better-sqlite3 prepared statements are reusable — preparing the same SQL
 * twice wastes the parse + plan phase. That's negligible for admin CLI
 * commands (one shot, process exits) but measurable on the MCP hot path
 * where `recall` / `search_documents` / `search_history` fire on every
 * client call over the life of the server.
 *
 * Callers replace `db.raw.prepare(SQL)` with `cached(db.raw, SQL)` on
 * statements that:
 *
 *   - are static SQL (NOT template-interpolated per call) — otherwise the
 *     cache key explodes with one entry per dynamic query;
 *   - live on a long-lived DB handle — the cache is keyed by the
 *     `Database` object via a WeakMap, so short-lived handles are
 *     collected normally.
 *
 * Not used for admin-CLI-only paths (tool add, scope add, ...) where the
 * savings are irrelevant and the extra indirection adds noise.
 */

// The cache is typed over an `unknown[]` bind tuple so call sites can pass
// whatever positional params their SQL expects. `better-sqlite3` validates
// the count at runtime and throws for mismatches; we rely on per-call-site
// discipline (static SQL + adjacent args) for correctness.
type Stmt = Database.Statement<unknown[], unknown>;

const CACHES = new WeakMap<Database.Database, Map<string, Stmt>>();

export function cached(db: Database.Database, sql: string): Stmt {
  let byDb = CACHES.get(db);
  if (!byDb) {
    byDb = new Map();
    CACHES.set(db, byDb);
  }
  let stmt = byDb.get(sql);
  if (!stmt) {
    stmt = db.prepare<unknown[], unknown>(sql);
    byDb.set(sql, stmt);
  }
  return stmt;
}
