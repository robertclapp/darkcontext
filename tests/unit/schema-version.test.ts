import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { openDb } from '../../src/core/store/db.js';
import { SCHEMA_VERSION } from '../../src/core/constants.js';
import { ConfigError } from '../../src/core/errors.js';

describe('schema version gating', () => {
  let dir: string;
  let dbPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dcx-schema-'));
    dbPath = join(dir, 'store.db');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('stamps the current SCHEMA_VERSION into meta on open', () => {
    const db = openDb({ path: dbPath });
    expect(db.schemaVersion).toBe(SCHEMA_VERSION);
    const row = db.raw.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string };
    expect(Number(row.value)).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('refuses to open a store written by a newer schema version', () => {
    // Prime the store, then bump schema_version beyond what the binary supports.
    openDb({ path: dbPath }).close();
    const raw = new Database(dbPath);
    raw.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION + 10));
    raw.close();

    expect(() => openDb({ path: dbPath })).toThrow(ConfigError);
  });

  it('silently upgrades a store written by an older schema (additive changes)', () => {
    openDb({ path: dbPath }).close();
    const raw = new Database(dbPath);
    raw.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run('1');
    raw.close();

    // Re-opening should upgrade without throwing.
    const db = openDb({ path: dbPath });
    expect(db.schemaVersion).toBe(SCHEMA_VERSION);
    db.close();
  });
});
