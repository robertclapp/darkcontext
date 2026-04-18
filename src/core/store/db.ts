import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sqliteVec from 'sqlite-vec';

import { SCHEMA_VERSION } from '../constants.js';
import { ConfigError } from '../errors.js';

import { defaultDbPath } from './paths.js';

export interface OpenDbOptions {
  path?: string;
  readonly?: boolean;
  /**
   * Optional SQLCipher key. When set we emit `PRAGMA key = ?` before the
   * first schema statement; this only encrypts the store if the underlying
   * SQLite build supports SQLCipher (stock better-sqlite3 does not — see
   * docs/SECURITY.md for the opt-in path).
   */
  encryptionKey?: string;
}

const SCHEMA_FILE = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');

export interface DarkContextDb {
  raw: Database.Database;
  hasVec: boolean;
  hasCipher: boolean;
  /**
   * Embedding dimension pinned in the store. 0 before the first write;
   * set by `setEmbedDim` + `VectorIndex.write` on first successful embed
   * and frozen thereafter. Mutable because the store only learns the dim
   * once the embedding provider actually produces a vector.
   */
  embedDim: number;
  /** Schema version read from the `meta` table on open (or 0 for new stores). */
  schemaVersion: number;
  close(): void;
}

/**
 * Open (and if needed, create) the DarkContext SQLite store.
 *
 * Phases (kept strict so the ordering is auditable):
 *   1. Open file; apply SQLCipher key if present.
 *   2. Pragmas (WAL, foreign_keys).
 *   3. Opportunistically load sqlite-vec (missing binary is not fatal).
 *   4. Ensure the `meta` table exists without touching any other table
 *      — we must be able to read schema_version before deciding whether
 *      to run the rest of schema.sql.
 *   5. Read the stored schema_version. If > SCHEMA_VERSION, refuse to
 *      proceed: a newer dcx wrote this store and rows may have columns
 *      this binary doesn't understand.
 *   6. Apply schema.sql in full (idempotent additive migrations).
 *   7. Stamp the new schema_version.
 *   8. Re-create vec0 virtual tables at the stored embed dim (if any).
 */
export function openDb(opts: OpenDbOptions = {}): DarkContextDb {
  const path = opts.path ?? defaultDbPath();
  if (!opts.readonly) mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, { readonly: opts.readonly ?? false });

  let hasCipher = false;
  if (opts.encryptionKey) hasCipher = applyCipherKey(db, opts.encryptionKey);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  let hasVec = false;
  try {
    sqliteVec.load(db);
    hasVec = true;
  } catch {
    hasVec = false;
  }

  if (!opts.readonly) {
    // Phase 4: bootstrap `meta` alone, then read version, THEN run the rest.
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }
  const previouslyStored = readSchemaVersion(db);
  if (previouslyStored > SCHEMA_VERSION) {
    db.close();
    throw new ConfigError(
      `database schema version ${previouslyStored} is newer than this binary supports (${SCHEMA_VERSION}). ` +
        `Upgrade darkcontext before opening this store.`
    );
  }

  if (!opts.readonly) {
    runSchema(db);
    stampSchemaVersion(db);
  }

  const embedDim = readEmbedDim(db);
  if (hasVec && !opts.readonly) ensureVecTables(db, embedDim);

  return {
    raw: db,
    hasVec,
    hasCipher,
    embedDim,
    schemaVersion: opts.readonly ? previouslyStored || SCHEMA_VERSION : SCHEMA_VERSION,
    close: () => db.close(),
  };
}

/**
 * Apply a SQLCipher key. Stock better-sqlite3 does NOT support the `key`
 * pragma, but the call is cheap (returns an empty result set) and we can
 * detect success by probing `cipher_version`. Callers decide what to do
 * with a `hasCipher: false` result — the CLI warns loudly in `dcx doctor`.
 */
function applyCipherKey(db: Database.Database, key: string): boolean {
  try {
    db.pragma(`key = '${key.replace(/'/g, "''")}'`);
  } catch {
    return false;
  }
  try {
    const row = db.pragma('cipher_version') as Array<{ cipher_version?: string }>;
    return Array.isArray(row) && row.length > 0 && !!row[0]?.cipher_version;
  } catch {
    return false;
  }
}

function runSchema(db: Database.Database): void {
  const sql = readFileSync(SCHEMA_FILE, 'utf8');
  db.exec(sql);
}

function readSchemaVersion(db: Database.Database): number {
  try {
    const row = db
      .prepare('SELECT value FROM meta WHERE key = ?')
      .get('schema_version') as { value: string } | undefined;
    return row ? Number(row.value) : 0;
  } catch {
    // `meta` doesn't exist yet — brand-new store.
    return 0;
  }
}

function stampSchemaVersion(db: Database.Database): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('schema_version', String(SCHEMA_VERSION));
}

function readEmbedDim(db: Database.Database): number {
  const row = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get('embed_dim') as { value: string } | undefined;
  return row ? Number(row.value) : 0;
}

export function setEmbedDim(db: Database.Database, dim: number): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run('embed_dim', String(dim));
}

export function ensureVecTables(db: Database.Database, dim: number): void {
  if (dim <= 0) return;
  // rowid is sqlite-vec's implicit primary key. Insertions bind BigInt
  // because better-sqlite3 binds JS Number as FLOAT, which sqlite-vec rejects.
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
       embedding FLOAT[${dim}]
     );`
  );
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_vec USING vec0(
       embedding FLOAT[${dim}]
     );`
  );
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS messages_vec USING vec0(
       embedding FLOAT[${dim}]
     );`
  );
}
