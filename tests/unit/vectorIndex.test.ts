import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb } from '../../src/core/store/db.js';
import { VectorIndex } from '../../src/core/store/vectorIndex.js';
import { EmbeddingError } from '../../src/core/embeddings/index.js';
import type { EmbeddingProvider } from '../../src/core/embeddings/index.js';

/**
 * Verifies two properties the code used to fail silently on:
 *   1. Embedding errors propagate (operators should see broken providers).
 *   2. `reindex` is atomic — a mid-way embedding failure must NOT leave the
 *      index in a half-populated state where the OLD rows are gone but the
 *      NEW ones aren't there yet.
 */

class FailingProvider implements EmbeddingProvider {
  readonly name = 'fail';
  readonly dimension = 8;
  constructor(private failAfter = 0) {}
  private calls = 0;
  async embed(texts: string[]): Promise<number[][]> {
    this.calls++;
    if (this.calls > this.failAfter) throw new EmbeddingError('simulated provider outage');
    return texts.map(() => new Array(this.dimension).fill(0).map((_, i) => i / this.dimension));
  }
}

describe('VectorIndex', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dcx-vi-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('write() propagates embedding errors instead of swallowing them', async () => {
    const db = openDb({ path: join(dir, 'store.db') });
    try {
      const idx = new VectorIndex(db, new FailingProvider(0), 'memories_vec');
      await expect(idx.write([1], ['hello'])).rejects.toBeInstanceOf(EmbeddingError);
    } finally {
      db.close();
    }
  });

  it('reindex() is atomic — a failing provider leaves the old index intact', async () => {
    const db = openDb({ path: join(dir, 'store.db') });
    try {
      // Seed a memory + its vector via a working provider.
      const working = new FailingProvider(999);
      const idx = new VectorIndex(db, working, 'memories_vec');
      db.raw.exec(`INSERT INTO memories (content, kind, tags_json, scope_id, created_at, updated_at)
                   VALUES ('hi', 'fact', '[]', 1, 1, 1)`);
      const id = (db.raw.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
      await idx.write([id], ['hi']);
      const before = (db.raw.prepare('SELECT count(*) AS c FROM memories_vec').get() as { c: number }).c;
      expect(before).toBe(1);

      // Now rebuild with a provider that fails on the first call.
      const broken = new VectorIndex(db, new FailingProvider(0), 'memories_vec');
      await expect(broken.reindex([id], ['hi'])).rejects.toBeInstanceOf(EmbeddingError);

      const after = (db.raw.prepare('SELECT count(*) AS c FROM memories_vec').get() as { c: number }).c;
      expect(after).toBe(1); // row survived the failed reindex
    } finally {
      db.close();
    }
  });

  it('reindex([]) truncates the index (delete-all semantics)', async () => {
    const db = openDb({ path: join(dir, 'store.db') });
    try {
      const idx = new VectorIndex(db, new FailingProvider(999), 'memories_vec');
      db.raw.exec(`INSERT INTO memories (content, kind, tags_json, scope_id, created_at, updated_at)
                   VALUES ('a', 'fact', '[]', 1, 1, 1)`);
      const id = (db.raw.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
      await idx.write([id], ['a']);
      expect((db.raw.prepare('SELECT count(*) AS c FROM memories_vec').get() as { c: number }).c).toBe(1);

      await idx.reindex([], []);
      expect((db.raw.prepare('SELECT count(*) AS c FROM memories_vec').get() as { c: number }).c).toBe(0);
    } finally {
      db.close();
    }
  });
});
