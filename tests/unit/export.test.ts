import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AppContext } from '../../src/core/context.js';
import { exportSnapshot, EXPORT_VERSION } from '../../src/core/export/index.js';

describe('exportSnapshot', () => {
  let tmp: string;
  let ctx: AppContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dcx-export-'));
    ctx = AppContext.open({ dbPath: join(tmp, 'store.db'), embeddings: 'stub' });
  });

  afterEach(() => {
    ctx.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('captures memories, documents (with chunks), conversations, and workspaces', async () => {
    ctx.scopes.upsert('work', 'Work context');
    await ctx.memories.remember({ content: 'Espresso descale every 60 shots', tags: ['coffee'] });
    await ctx.memories.remember({ content: 'Q2 OKRs locked', scope: 'work', kind: 'note' });
    await ctx.documents.ingest({
      title: 'Handbook',
      content: 'chapter one. chapter two. chapter three.',
      scope: 'work',
    });
    await ctx.conversations.ingest(
      'chatgpt',
      [
        {
          externalId: 'c-1',
          title: 'Espresso talk',
          startedAt: 1700000000000,
          messages: [
            { role: 'user', content: 'hi', ts: 1700000000000 },
            { role: 'assistant', content: 'hello', ts: 1700000001000 },
          ],
        },
      ],
      { scope: 'work' }
    );
    const ws = ctx.workspaces.create({ name: 'Sprint', scope: 'work' });
    ctx.workspaces.addItem(ws.id, { kind: 'task', content: 'ship export' });

    const snap = exportSnapshot(ctx.db);

    expect(snap.version).toBe(EXPORT_VERSION);
    expect(snap.schemaVersion).toBeGreaterThan(0);
    expect(snap.scopeFilter).toBeNull();

    // Scopes include default (seeded) + work
    expect(snap.scopes.map((s) => s.name).sort()).toEqual(['default', 'work']);

    expect(snap.memories).toHaveLength(2);
    const memories = snap.memories.map((m) => ({ scope: m.scope, content: m.content, tags: m.tags }));
    expect(memories).toContainEqual({
      scope: 'default',
      content: 'Espresso descale every 60 shots',
      tags: ['coffee'],
    });
    expect(memories).toContainEqual({ scope: 'work', content: 'Q2 OKRs locked', tags: [] });

    expect(snap.documents).toHaveLength(1);
    expect(snap.documents[0]!.title).toBe('Handbook');
    expect(snap.documents[0]!.scope).toBe('work');
    expect(snap.documents[0]!.chunks.length).toBeGreaterThan(0);
    expect(snap.documents[0]!.chunks[0]!.idx).toBe(0);

    expect(snap.conversations).toHaveLength(1);
    expect(snap.conversations[0]!.source).toBe('chatgpt');
    expect(snap.conversations[0]!.externalId).toBe('c-1');
    expect(snap.conversations[0]!.messages).toHaveLength(2);
    expect(snap.conversations[0]!.messages[0]!.role).toBe('user');

    expect(snap.workspaces).toHaveLength(1);
    expect(snap.workspaces[0]!.name).toBe('Sprint');
    expect(snap.workspaces[0]!.items).toEqual([
      {
        kind: 'task',
        content: 'ship export',
        state: 'open',
        updatedAt: expect.any(Number),
      },
    ]);
  });

  it('strips store-local ids and embeddings so the output is portable', async () => {
    await ctx.memories.remember({ content: 'portable fact' });
    const snap = exportSnapshot(ctx.db);
    const mem = snap.memories[0]!;
    // IDs are store-local — export keeps content-addressable fields only.
    expect(mem).not.toHaveProperty('id');
    expect(mem).not.toHaveProperty('embedding');
    expect(snap).not.toHaveProperty('memoriesVec');
  });

  it('scope filter restricts every section to the named scope', async () => {
    ctx.scopes.upsert('work');
    ctx.scopes.upsert('personal');
    await ctx.memories.remember({ content: 'work fact', scope: 'work' });
    await ctx.memories.remember({ content: 'personal fact', scope: 'personal' });
    await ctx.documents.ingest({ title: 'Work doc', content: 'x', scope: 'work' });
    await ctx.documents.ingest({ title: 'Personal doc', content: 'y', scope: 'personal' });
    const ws = ctx.workspaces.create({ name: 'WorkWs', scope: 'work' });
    ctx.workspaces.addItem(ws.id, { kind: 'task', content: 'do' });
    ctx.workspaces.create({ name: 'PersonalWs', scope: 'personal' });

    const workSnap = exportSnapshot(ctx.db, { scope: 'work' });
    expect(workSnap.scopeFilter).toBe('work');
    expect(workSnap.scopes).toEqual([{ name: 'work', description: null }]);
    expect(workSnap.memories.map((m) => m.content)).toEqual(['work fact']);
    expect(workSnap.documents.map((d) => d.title)).toEqual(['Work doc']);
    expect(workSnap.workspaces.map((w) => w.name)).toEqual(['WorkWs']);
  });

  it('produces deterministic-shape JSON that round-trips through parse/stringify', async () => {
    await ctx.memories.remember({ content: 'fact', tags: ['a', 'b'] });
    const snap = exportSnapshot(ctx.db);
    const serialized = JSON.stringify(snap);
    const parsed = JSON.parse(serialized);
    expect(parsed).toEqual(snap);
  });

  it('omits tool tokens and the audit log by default', async () => {
    await ctx.memories.remember({ content: 'something' });
    const snap = exportSnapshot(ctx.db);
    expect(snap).not.toHaveProperty('tools');
    expect(snap).not.toHaveProperty('auditLog');
    expect(snap).not.toHaveProperty('tokens');
  });
});
