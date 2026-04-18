import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { makeFixture, type Fixture } from '../helpers/factory.js';

describe('reindex', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => fx.cleanup());

  it('Memories.reindex: rebuilds memories_vec from stored content', async () => {
    await fx.memories.remember({ content: 'descale espresso every 60 shots', tags: ['coffee'] });
    await fx.memories.remember({ content: 'eastern forehand grip' });

    // Drop the vec rows to simulate a failed-embedding state.
    fx.db.raw.exec('DELETE FROM memories_vec');
    expect((fx.db.raw.prepare('SELECT count(*) AS c FROM memories_vec').get() as { c: number }).c).toBe(0);

    const n = await fx.memories.reindex();
    expect(n).toBe(2);
    const after = (fx.db.raw.prepare('SELECT count(*) AS c FROM memories_vec').get() as { c: number }).c;
    expect(after).toBe(2);

    // Vector recall now works again.
    const hits = await fx.memories.recall('coffee maintenance', { limit: 2 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.match).toBe('vector');
  });

  it('Documents.reindex: rebuilds document_chunks_vec for every chunk', async () => {
    await fx.documents.ingest(
      { title: 'doc.md', content: 'alpha beta gamma\n\ndelta epsilon zeta\n\niota kappa lambda' },
      { size: 20, overlap: 5 }
    );
    const chunkCount = (fx.db.raw.prepare('SELECT count(*) AS c FROM document_chunks').get() as { c: number }).c;

    fx.db.raw.exec('DELETE FROM document_chunks_vec');
    expect((fx.db.raw.prepare('SELECT count(*) AS c FROM document_chunks_vec').get() as { c: number }).c).toBe(0);

    const n = await fx.documents.reindex();
    expect(n).toBe(chunkCount);
  });

  it('Conversations.reindex: rebuilds messages_vec for every message', async () => {
    await fx.conversations.ingest('chatgpt', [
      {
        externalId: 'c1',
        title: 'chat',
        startedAt: 1700000000000,
        messages: [
          { role: 'user', content: 'hi', ts: 1700000000000 },
          { role: 'assistant', content: 'hello', ts: 1700000001000 },
        ],
      },
    ]);

    fx.db.raw.exec('DELETE FROM messages_vec');
    const n = await fx.conversations.reindex();
    expect(n).toBe(2);
    expect((fx.db.raw.prepare('SELECT count(*) AS c FROM messages_vec').get() as { c: number }).c).toBe(2);
  });
});
