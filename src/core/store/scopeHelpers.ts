import type Database from 'better-sqlite3';

import { DEFAULT_SCOPE_NAME } from '../constants.js';
import { ValidationError } from '../errors.js';

/**
 * Resolve a scope by name, creating it on demand.
 *
 * Atomic: uses `INSERT … ON CONFLICT DO NOTHING` + `SELECT`, so concurrent
 * callers racing on the same scope name never produce a UNIQUE-constraint
 * error. Names are normalized with `.trim()`; empty names are rejected
 * upstream by `resolveScopeOrDefault`.
 */
export function resolveScopeId(db: Database.Database, name: string): number {
  const info = db
    .prepare('INSERT INTO scopes (name) VALUES (?) ON CONFLICT(name) DO NOTHING')
    .run(name);
  if (info.changes === 1) return Number(info.lastInsertRowid);
  const row = db.prepare('SELECT id FROM scopes WHERE name = ?').get(name) as
    | { id: number }
    | undefined;
  if (!row) throw new Error(`failed to resolve scope '${name}'`);
  return row.id;
}

/**
 * The 'default' scope is seeded by schema.sql and is guaranteed to exist
 * on any DB produced by openDb(). Missing it indicates a corrupted store.
 */
export function defaultScopeId(db: Database.Database): number {
  const row = db.prepare('SELECT id FROM scopes WHERE name = ?').get(DEFAULT_SCOPE_NAME) as
    | { id: number }
    | undefined;
  if (!row) throw new Error(`'${DEFAULT_SCOPE_NAME}' scope missing — did you run migrations?`);
  return row.id;
}

/**
 * Resolve an optional scope name.
 *   - `undefined`         → default scope
 *   - empty / whitespace  → ValidationError (silently routing an
 *                           empty-string name to `default` would hide
 *                           caller bugs)
 *   - otherwise            → `resolveScopeId` (creates on demand)
 */
export function resolveScopeOrDefault(db: Database.Database, name: string | undefined): number {
  if (name === undefined) return defaultScopeId(db);
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('scope', 'scope name must be non-empty (omit the field for default)');
  }
  return resolveScopeId(db, trimmed);
}
