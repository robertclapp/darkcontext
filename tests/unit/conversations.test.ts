import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { makeFixture, type Fixture } from '../helpers/factory.js';
import type { ImportedConversation } from '../../src/core/conversations/index.js';

const sample: ImportedConversation[] = [
  {
    externalId: 'c1',
    title: 'Espresso',
    startedAt: 1700000000000,
    messages: [
      { role: 'user', content: 'How do I descale an espresso machine?', ts: 1700000000000 },
      { role: 'assistant', content: 'Every 60 shots with citric acid.', ts: 1700000001000 },
    ],
  },
  {
    externalId: 'c2',
    title: 'Tennis',
    startedAt: 1700010000000,
    messages: [
      { role: 'user', content: 'Which grip for topspin forehand?', ts: 1700010000000 },
      { role: 'assistant', content: 'Eastern or semi-western grip.', ts: 1700010001000 },
    ],
  },
];

describe('Conversations', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => fx.cleanup());

  it('ingests conversations + messages and lists them', async () => {
    const res = await fx.conversations.ingest('chatgpt', sample, { scope: 'default' });
    expect(res.inserted).toBe(2);
    expect(res.messages).toBe(4);
    expect(res.skipped).toBe(0);

    const list = fx.conversations.list();
    expect(list).toHaveLength(2);
  });

  it('skips conversations that were already imported (source, externalId unique)', async () => {
    await fx.conversations.ingest('chatgpt', sample);
    const second = await fx.conversations.ingest('chatgpt', sample);
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(2);
  });

  it('searches message content by semantic similarity', async () => {
    await fx.conversations.ingest('chatgpt', sample);
    const hits = await fx.conversations.search('maintenance for coffee machine', { limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.title).toMatch(/Espresso|Tennis/);
  });

  it('filters by source', async () => {
    await fx.conversations.ingest('chatgpt', [sample[0]!]);
    await fx.conversations.ingest('claude', [sample[1]!]);
    const claudeHits = await fx.conversations.search('topspin', { source: 'claude' });
    expect(claudeHits.every((h) => h.source === 'claude')).toBe(true);
  });

  it('filters by scope', async () => {
    await fx.conversations.ingest('chatgpt', [sample[0]!], { scope: 'work' });
    await fx.conversations.ingest('chatgpt', [sample[1]!], { scope: 'personal' });
    const workHits = await fx.conversations.search('forehand', { scope: 'work' });
    expect(workHits.every((h) => h.scope === 'work')).toBe(true);
  });

  it('delete cascades to messages and vectors', async () => {
    await fx.conversations.ingest('chatgpt', sample);
    const list = fx.conversations.list();
    const ok = fx.conversations.delete(list[0]!.id);
    expect(ok).toBe(true);
    const remaining = fx.db.raw
      .prepare('SELECT count(*) AS c FROM messages WHERE conversation_id = ?')
      .get(list[0]!.id) as { c: number };
    expect(remaining.c).toBe(0);
  });

  it('messages() returns chronological order within a conversation', async () => {
    await fx.conversations.ingest('chatgpt', sample);
    const list = fx.conversations.list();
    const msgs = fx.conversations.messages(list[0]!.id);
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i]!.ts).toBeGreaterThanOrEqual(msgs[i - 1]!.ts);
    }
  });
});
