import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { makeFixture, type Fixture } from '../helpers/factory.js';

describe('Documents', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => fx.cleanup());

  it('ingests, chunks, and retrieves a document', async () => {
    const content =
      'Espresso machines need regular maintenance. Descale the boiler every 60 shots with citric acid.\n\n'.repeat(
        8
      );
    const res = await fx.documents.ingest(
      { title: 'coffee-care.txt', content, scope: 'default' },
      { size: 200, overlap: 40 }
    );
    expect(res.document.id).toBeGreaterThan(0);
    expect(res.document.scope).toBe('default');
    expect(res.chunks).toBeGreaterThan(1);

    const list = fx.documents.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.title).toBe('coffee-care.txt');
  });

  it('searches chunks by semantic similarity', async () => {
    await fx.documents.ingest({
      title: 'coffee.txt',
      content: 'Descale the espresso boiler every 60 shots with citric acid to prevent scaling.',
      scope: 'default',
    });
    await fx.documents.ingest({
      title: 'tennis.txt',
      content: 'The eastern forehand grip encourages topspin; adjust the continental grip for volleys.',
      scope: 'default',
    });
    const hits = await fx.documents.search('how do I maintain the espresso machine', { limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    // Top hit must be the coffee doc, not the unrelated tennis one —
    // the loose `toMatch(/coffee|tennis/)` was insensitive to ranking
    // regressions where tennis would win.
    expect(hits[0]!.title).toBe('coffee.txt');
  });

  it('filters by scope', async () => {
    await fx.documents.ingest({ title: 'a', content: 'alpha content', scope: 'work' });
    await fx.documents.ingest({ title: 'b', content: 'beta content', scope: 'personal' });
    const workHits = await fx.documents.search('content', { scope: 'work' });
    // Assert we actually retrieved something — otherwise `every` trivially
    // passes on an empty array.
    expect(workHits.length).toBeGreaterThan(0);
    expect(workHits.every((h) => h.scope === 'work')).toBe(true);
  });

  it('deletes a document and its chunks', async () => {
    const { document } = await fx.documents.ingest({
      title: 'delete-me',
      content: 'kill this document',
    });
    expect(fx.documents.delete(document.id)).toBe(true);
    expect(fx.documents.list()).toHaveLength(0);
    const chunks = fx.db.raw
      .prepare('SELECT count(*) AS c FROM document_chunks WHERE document_id = ?')
      .get(document.id) as { c: number };
    expect(chunks.c).toBe(0);
  });
});
