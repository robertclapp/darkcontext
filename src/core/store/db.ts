import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as sqliteVec from 'sqlite-vec';

import { defaultDbPath } from './paths.js';

export interface OpenDbOptions {
  path?: string;
  readonly?: boolean;
}

const SCHEMA_FILE = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');

export interface DarkContextDb {
  raw: Database.Database;
  hasVec: boolean;
  embedDim: number;
  close(): void;
}

/**
 * Open (and if needed, create) the DarkContext SQLite store.
 * `sqlite-vec` is loaded opportunistically — if the platform binary is missing
 * we still return a working DB without vector tables; callers fall back to
 * keyword search.
 */
export function openDb(opts: OpenDbOptions = {}): DarkContextDb {
  const path = opts.path ?? defaultDbPath();
  if (!opts.readonly) mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, { readonly: opts.readonly ?? false });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  let hasVec = false;
  try {
    sqliteVec.load(db);
    hasVec = true;
  } catch {
    hasVec = false;
  }

  if (!opts.readonly) runSchema(db);

  const embedDim = readEmbedDim(db);
  if (hasVec && !opts.readonly) ensureVecTables(db, embedDim);

  return {
    raw: db,
    hasVec,
    embedDim,
    close: () => db.close(),
  };
}

function runSchema(db: Database.Database): void {
  const sql = readFileSync(SCHEMA_FILE, 'utf8');
  db.exec(sql);
  db.prepare(
    'INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)'
  ).run('schema_version', '1');
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
  // memory_id is mapped to sqlite-vec's implicit rowid — inserts use the
  // `rowid` alias, which keeps binding order PK-first, blob-second.
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS memories_vec USING vec0(
       embedding FLOAT[${dim}]
     );`
  );
}
