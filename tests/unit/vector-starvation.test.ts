import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, type DarkContextDb } from '../../src/core/store/db.js';
import { Memories } from '../../src/core/memories/index.js';
import { Documents } from '../../src/core/documents/index.js';
import { Conversations } from '../../src/core/conversations/index.js';
import type { EmbeddingProvider } from '../../src/core/embeddings/index.js';

/**
 * Regression guard for vector-search scope starvation.
 *
 * `sqlite-vec` returns the globally-nearest `k` vectors before any scope
 * filter applies. The old code bound `k = limit`, so a dense neighbouring
 * scope occupying the top-`limit` slots could hide — or entirely starve —
 * a caller's in-scope matches. The fix is adaptive widening.
 *
 * To make the skew deterministic (the stub provider's hash vectors aren't
 * tunable), we use a 1-D provider that maps a number encoded in the
 * content to dim 0. We then cluster many `noise`-scope vectors strictly
 * nearer the query than the single `target`-scope match, guaranteeing the
 * target falls outside any small `k` window.
 */

/** Maps content "n:<number>" to the vector [number, 0, …]. Distance to the
 *  query is then |number - queryNumber|, fully controllable. */
class LinearProvider implements EmbeddingProvider {
  readonly name = 'linear-test';
  readonly dimension = 4;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const m = /(-?\d+(?:\.\d+)?)/.exec(t);
      const x = m ? Number(m[1]) : 0;
      return [x, 0, 0, 0];
    });
  }
}

describe('vector search resists scope starvation', () => {
  let dir: string;
  let db: DarkContextDb;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dcx-starve-'));
    db = openDb({ path: join(dir, 'store.db') });
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('memories: a dense neighbouring scope cannot hide an in-scope match', async () => {
    const mem = new Memories(db, new LinearProvider());

    // 50 noise memories clustered at x≈0.0–0.49 in scope "noise".
    for (let i = 0; i < 50; i++) {
      await mem.remember({ content: `n:0.${String(i).padStart(2, '0')}`, scope: 'noise' });
    }
    // One target memory at x=1 in scope "target" — strictly farther from
    // the query (x=0) than every noise vector.
    await mem.remember({ content: 'n:1', scope: 'target' });

    // Query at x=0, limit 5. The 5 nearest are all noise; the target is the
    // 51st-nearest. Old behaviour (k=limit, post-filter) → zero results.
    const hits = await mem.recall('n:0', { limit: 5, scope: 'target' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.memory.scope).toBe('target');
    expect(hits[0]!.memory.content).toBe('n:1');
  });

  it('memories: readable-scope SET (multi) survives the same skew', async () => {
    const mem = new Memories(db, new LinearProvider());
    for (let i = 0; i < 40; i++) {
      await mem.remember({ content: `n:0.${String(i).padStart(2, '0')}`, scope: 'noise' });
    }
    await mem.remember({ content: 'n:2', scope: 'work' });

    // Caller may read work + personal (not noise). Query nearest are all
    // noise; the work match must still surface.
    const hits = await mem.recall('n:0', { limit: 3, scopes: ['work', 'personal'] });
    expect(hits.map((h) => h.memory.scope)).toContain('work');
  });

  it('empty readable set returns nothing without scanning', async () => {
    const mem = new Memories(db, new LinearProvider());
    await mem.remember({ content: 'n:1', scope: 'secret' });
    expect(await mem.recall('n:1', { limit: 5, scopes: [] })).toEqual([]);
  });

  it('documents: dense neighbouring scope cannot hide an in-scope chunk', async () => {
    const docs = new Documents(db, new LinearProvider());
    for (let i = 0; i < 40; i++) {
      // single-chunk docs; content carries the coordinate
      await docs.ingest({ title: `noise-${i}`, content: `n:0.${String(i).padStart(2, '0')}`, scope: 'noise' });
    }
    await docs.ingest({ title: 'wanted', content: 'n:3', scope: 'target' });

    const hits = await docs.search('n:0', { limit: 4, scope: 'target' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.scope === 'target')).toBe(true);
    expect(hits[0]!.title).toBe('wanted');
  });

  it('conversations: dense neighbouring scope cannot hide an in-scope message', async () => {
    const conv = new Conversations(db, new LinearProvider());
    const noise = Array.from({ length: 40 }, (_, i) => ({
      externalId: `noise-${i}`,
      title: `noise ${i}`,
      startedAt: 1_700_000_000_000 + i,
      messages: [{ role: 'user', content: `n:0.${String(i).padStart(2, '0')}`, ts: 1_700_000_000_000 + i }],
    }));
    await conv.ingest('chatgpt', noise, { scope: 'noise' });
    await conv.ingest('chatgpt', [
      {
        externalId: 'wanted',
        title: 'wanted',
        startedAt: 1_700_000_001_000,
        messages: [{ role: 'user', content: 'n:5', ts: 1_700_000_001_000 }],
      },
    ], { scope: 'target' });

    const hits = await conv.search('n:0', { limit: 3, scope: 'target' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.scope === 'target')).toBe(true);
  });
});
