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
});
