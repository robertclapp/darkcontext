import type Database from 'better-sqlite3';

/**
 * Resolve a scope by name, creating it on demand. Keeps scope names as a
 * first-class caller concern while letting the row-insert paths stay
 * straightforward (most callers don't want to handle "does this scope
 * exist yet?").
 */
export function resolveScopeId(db: Database.Database, name: string): number {
  const row = db.prepare('SELECT id FROM scopes WHERE name = ?').get(name) as
    | { id: number }
    | undefined;
  if (row) return row.id;
  const info = db.prepare('INSERT INTO scopes (name) VALUES (?)').run(name);
  return Number(info.lastInsertRowid);
}

/**
 * The 'default' scope is seeded by schema.sql and is guaranteed to exist
 * on any DB produced by openDb(). Missing it indicates a corrupted store.
 */
export function defaultScopeId(db: Database.Database): number {
  const row = db.prepare("SELECT id FROM scopes WHERE name = 'default'").get() as
    | { id: number }
    | undefined;
  if (!row) throw new Error('default scope missing — did you run migrations?');
  return row.id;
}

/** Resolve the given name, or fall back to the default when no name is given. */
export function resolveScopeOrDefault(db: Database.Database, name: string | undefined): number {
  return name ? resolveScopeId(db, name) : defaultScopeId(db);
}
