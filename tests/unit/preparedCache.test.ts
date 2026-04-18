import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { cached } from '../../src/core/store/preparedCache.js';

describe('preparedCache', () => {
  let dir: string;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it('returns the SAME Statement instance for the same (db, sql) pair', () => {
    dir = mkdtempSync(join(tmpdir(), 'dcx-pc-'));
    const db = new Database(join(dir, 'x.db'));
    try {
      const s1 = cached(db, 'SELECT 1');
      const s2 = cached(db, 'SELECT 1');
      expect(s1).toBe(s2);
    } finally {
      db.close();
    }
  });

  it('different SQL strings produce different Statements', () => {
    dir = mkdtempSync(join(tmpdir(), 'dcx-pc-'));
    const db = new Database(join(dir, 'x.db'));
    try {
      const a = cached(db, 'SELECT 1');
      const b = cached(db, 'SELECT 2');
      expect(a).not.toBe(b);
    } finally {
      db.close();
    }
  });

  it('different DB handles have separate caches (no cross-contamination)', () => {
    dir = mkdtempSync(join(tmpdir(), 'dcx-pc-'));
    const d1 = new Database(join(dir, 'a.db'));
    const d2 = new Database(join(dir, 'b.db'));
    try {
      const s1 = cached(d1, 'SELECT 1');
      const s2 = cached(d2, 'SELECT 1');
      // Same SQL, different DBs → different Statements.
      expect(s1).not.toBe(s2);
    } finally {
      d1.close();
      d2.close();
    }
  });

  it('queries via cached() produce the same results as fresh prepare()', () => {
    dir = mkdtempSync(join(tmpdir(), 'dcx-pc-'));
    const db = new Database(join(dir, 'x.db'));
    try {
      db.exec('CREATE TABLE t (k TEXT PRIMARY KEY, v INTEGER)');
      db.prepare('INSERT INTO t (k, v) VALUES (?, ?)').run('one', 1);
      db.prepare('INSERT INTO t (k, v) VALUES (?, ?)').run('two', 2);

      const sql = 'SELECT v FROM t WHERE k = ?';
      const first = cached(db, sql).get('one');
      const second = cached(db, sql).get('two');
      expect(first).toEqual({ v: 1 });
      expect(second).toEqual({ v: 2 });
    } finally {
      db.close();
    }
  });
});
