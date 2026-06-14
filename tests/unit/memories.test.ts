import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, type DarkContextDb } from '../../src/core/store/db.js';
import { Memories } from '../../src/core/memories/index.js';
import { StubEmbeddingProvider } from '../../src/core/embeddings/stub.js';

describe('Memories', () => {
  let tmp: string;
  let db: DarkContextDb;
  let memories: Memories;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dcx-'));
    db = openDb({ path: join(tmp, 'store.db') });
    memories = new Memories(db, new StubEmbeddingProvider(64));
  });

  afterEach(() => {
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('remembers and lists a memory under the default scope', async () => {
    const m = await memories.remember({ content: 'Descale espresso every 60 shots', tags: ['coffee'] });
    expect(m.id).toBeGreaterThan(0);
    expect(m.scope).toBe('default');
    expect(m.tags).toEqual(['coffee']);

    const all = memories.list();
    expect(all).toHaveLength(1);
    expect(all[0]!.content).toBe('Descale espresso every 60 shots');
  });

  it('creates scopes on demand', async () => {
    await memories.remember({ content: 'Q2 OKRs locked', scope: 'work' });
    const workOnly = memories.list({ scope: 'work' });
    expect(workOnly).toHaveLength(1);
    expect(workOnly[0]!.scope).toBe('work');

    const defaultOnly = memories.list({ scope: 'default' });
    expect(defaultOnly).toHaveLength(0);
  });

  it('recall returns the most relevant memory for a query', async () => {
    await memories.remember({ content: 'Descale espresso every 60 shots' });
    await memories.remember({ content: 'Tennis forehand grip is eastern' });
    await memories.remember({ content: 'Calendar timezone is America/Los_Angeles' });

    const hits = await memories.recall('espresso descale', { limit: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.memory.content).toContain('Descale espresso');
  });

  it('forget removes the memory and its vector row', async () => {
    const m = await memories.remember({ content: 'delete me' });
    expect(memories.forget(m.id)).toBe(true);
    expect(memories.list()).toHaveLength(0);
    expect(memories.forget(m.id)).toBe(false);
  });

  it('falls back to keyword recall when vectors are not available', async () => {
    // Simulate the no-vec case by clobbering the flag after first write.
    await memories.remember({ content: 'Keyword fallback path' });
    (db as { hasVec: boolean }).hasVec = false;

    const hits = await memories.recall('fallback');
    expect(hits.length).toBe(1);
    expect(hits[0]!.match).toBe('keyword');
  });

  describe('rememberOrMerge', () => {
    it('merges near-duplicate content into the existing row (same scope)', async () => {
      const first = await memories.remember({ content: 'Espresso descaling every 60 shots' });
      const res = await memories.rememberOrMerge({
        content: 'Espresso descaling every 60 shots',
        tags: ['coffee'],
      });
      expect(res.merged).toBe(true);
      expect(res.memory.id).toBe(first.id);
      expect(res.memory.tags).toEqual(['coffee']);
      expect(memories.list()).toHaveLength(1);
    });

    it('inserts a fresh row when no candidate is within the distance threshold', async () => {
      await memories.remember({ content: 'Espresso descaling every 60 shots' });
      const res = await memories.rememberOrMerge({
        content: 'Completely unrelated tennis forehand tip',
      });
      expect(res.merged).toBe(false);
      expect(memories.list()).toHaveLength(2);
    });

    it('unions tags and keeps the newest content when merging', async () => {
      const first = await memories.remember({
        content: 'Descale every 60 shots',
        tags: ['coffee'],
      });
      const res = await memories.rememberOrMerge({
        content: 'Descale every 60 shots',
        tags: ['maintenance'],
      });
      expect(res.merged).toBe(true);
      expect(res.memory.id).toBe(first.id);
      expect(res.memory.tags.sort()).toEqual(['coffee', 'maintenance']);
    });

    it('does not merge across scope boundaries', async () => {
      await memories.remember({ content: 'shared phrase', scope: 'work' });
      const res = await memories.rememberOrMerge({
        content: 'shared phrase',
        scope: 'personal',
      });
      expect(res.merged).toBe(false);
      expect(memories.list()).toHaveLength(2);
      expect(memories.list({ scope: 'work' })).toHaveLength(1);
      expect(memories.list({ scope: 'personal' })).toHaveLength(1);
    });

    it('falls back to a plain insert when vectors are unavailable', async () => {
      await memories.remember({ content: 'existing fact' });
      (db as { hasVec: boolean }).hasVec = false;
      const res = await memories.rememberOrMerge({ content: 'existing fact' });
      expect(res.merged).toBe(false);
      expect(memories.list()).toHaveLength(2);
    });

    it('respects the threshold: a tiny threshold disables merging', async () => {
      await memories.remember({ content: 'repeat fact' });
      const res = await memories.rememberOrMerge({ content: 'repeat fact' }, 0);
      expect(res.merged).toBe(false);
      expect(memories.list()).toHaveLength(2);
    });

    it('rejects a negative threshold', async () => {
      await expect(
        memories.rememberOrMerge({ content: 'x' }, -1)
      ).rejects.toThrow(/non-negative/);
    });
  });
});
