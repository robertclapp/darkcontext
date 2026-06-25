import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AppContext } from '../../src/core/context.js';
import { NotFoundError, ValidationError } from '../../src/core/errors.js';

const DAY = 86_400_000;

describe('Retention', () => {
  let tmp: string;
  let ctx: AppContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dcx-ret-'));
    ctx = AppContext.open({ dbPath: join(tmp, 'store.db'), embeddings: 'stub' });
  });

  afterEach(() => {
    ctx.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('rule CRUD', () => {
    it('creates the scope on demand and stores the rule', () => {
      const rule = ctx.retention.set('ephemeral', 7);
      expect(rule).toEqual({ scope: 'ephemeral', days: 7 });
      expect(ctx.retention.get('ephemeral')).toEqual({ scope: 'ephemeral', days: 7 });
    });

    it('updates an existing rule in place', () => {
      ctx.retention.set('work', 30);
      ctx.retention.set('work', 90);
      expect(ctx.retention.get('work')).toEqual({ scope: 'work', days: 90 });
    });

    it('lists every rule sorted by scope name', () => {
      ctx.retention.set('zeta', 10);
      ctx.retention.set('alpha', 3);
      ctx.retention.set('mu', 60);
      expect(ctx.retention.list()).toEqual([
        { scope: 'alpha', days: 3 },
        { scope: 'mu', days: 60 },
        { scope: 'zeta', days: 10 },
      ]);
    });

    it('clear removes a rule and reports whether one existed', () => {
      ctx.retention.set('tmp', 1);
      expect(ctx.retention.clear('tmp')).toBe(true);
      expect(ctx.retention.get('tmp')).toBeNull();
      expect(ctx.retention.clear('tmp')).toBe(false);
    });

    it('clear on an unknown scope is a no-op returning false', () => {
      expect(ctx.retention.clear('never-existed')).toBe(false);
    });

    it('rejects non-positive or non-integer days with ValidationError', () => {
      expect(() => ctx.retention.set('x', 0)).toThrow(ValidationError);
      expect(() => ctx.retention.set('x', -5)).toThrow(ValidationError);
      expect(() => ctx.retention.set('x', 1.5)).toThrow(ValidationError);
    });
  });

  describe('prune', () => {
    it('returns all-zero counts and scanned=0 when no rules exist', () => {
      const res = ctx.retention.prune();
      expect(res.scanned).toBe(0);
      expect(res.scopes).toHaveLength(0);
      expect(res.total).toEqual({
        memories: 0,
        documents: 0,
        conversations: 0,
        workspaceItems: 0,
      });
    });

    it('deletes memories older than the retention window', async () => {
      ctx.retention.set('chat', 3);
      await ctx.memories.remember({ content: 'old fact', scope: 'chat' });
      await ctx.memories.remember({ content: 'fresh fact', scope: 'chat' });
      // Age the first memory by 5 days to cross the 3-day cutoff.
      const now = Date.now();
      ctx.db.raw
        .prepare(`UPDATE memories SET created_at = ? WHERE content = 'old fact'`)
        .run(now - 5 * DAY);

      const res = ctx.retention.prune({ now });
      expect(res.scanned).toBe(1);
      expect(res.scopes[0]!.counts.memories).toBe(1);
      expect(res.total.memories).toBe(1);

      const remaining = ctx.memories.list({ scope: 'chat' }).map((m) => m.content);
      expect(remaining).toEqual(['fresh fact']);
    });

    it('dry-run reports counts without deleting anything', async () => {
      ctx.retention.set('chat', 3);
      await ctx.memories.remember({ content: 'should survive a dry run', scope: 'chat' });
      const now = Date.now();
      ctx.db.raw
        .prepare(`UPDATE memories SET created_at = ? WHERE scope_id = (SELECT id FROM scopes WHERE name = 'chat')`)
        .run(now - 10 * DAY);

      const res = ctx.retention.prune({ now, dryRun: true });
      expect(res.dryRun).toBe(true);
      expect(res.scopes[0]!.counts.memories).toBe(1);
      expect(ctx.memories.list({ scope: 'chat' })).toHaveLength(1);
    });

    it('prunes documents by ingested_at, conversations by started_at, workspace items by updated_at', async () => {
      ctx.retention.set('work', 5);
      await ctx.documents.ingest({
        title: 'Old handbook',
        content: 'stale chapter',
        scope: 'work',
      });
      await ctx.conversations.ingest(
        'chatgpt',
        [
          {
            externalId: 'old',
            title: 'old chat',
            startedAt: Date.now(),
            messages: [{ role: 'user', content: 'hi', ts: Date.now() }],
          },
        ],
        { scope: 'work' }
      );
      const ws = ctx.workspaces.create({ name: 'WorkWs', scope: 'work' });
      ctx.workspaces.addItem(ws.id, { kind: 'task', content: 'old task' });

      const now = Date.now();
      const pastCutoff = now - 10 * DAY;
      ctx.db.raw.prepare('UPDATE documents SET ingested_at = ?').run(pastCutoff);
      ctx.db.raw.prepare('UPDATE conversations SET started_at = ?').run(pastCutoff);
      ctx.db.raw.prepare('UPDATE workspace_items SET updated_at = ?').run(pastCutoff);

      const res = ctx.retention.prune({ now });
      expect(res.total).toEqual({
        memories: 0,
        documents: 1,
        conversations: 1,
        workspaceItems: 1,
      });
      expect(ctx.documents.list({ scope: 'work' })).toHaveLength(0);
      // Workspace itself survives — containers aren't pruned.
      expect(ctx.workspaces.list({ scope: 'work' })).toHaveLength(1);
    });

    it('does not touch scopes without a retention rule', async () => {
      ctx.retention.set('chat', 3);
      await ctx.memories.remember({ content: 'chat old', scope: 'chat' });
      await ctx.memories.remember({ content: 'retained forever', scope: 'archive' });

      const now = Date.now();
      // Age BOTH memories well past the 3-day window.
      ctx.db.raw.prepare('UPDATE memories SET created_at = ?').run(now - 100 * DAY);

      const res = ctx.retention.prune({ now });
      expect(res.total.memories).toBe(1);
      expect(ctx.memories.list({ scope: 'archive' })).toHaveLength(1);
    });

    it('restricts the sweep to --scope when provided', async () => {
      ctx.retention.set('chat', 3);
      ctx.retention.set('work', 30);
      await ctx.memories.remember({ content: 'chat old', scope: 'chat' });
      await ctx.memories.remember({ content: 'work old', scope: 'work' });
      const now = Date.now();
      ctx.db.raw.prepare('UPDATE memories SET created_at = ?').run(now - 100 * DAY);

      const res = ctx.retention.prune({ scope: 'chat', now });
      expect(res.scanned).toBe(1);
      expect(res.scopes[0]!.scope).toBe('chat');
      expect(res.total.memories).toBe(1);
      // Work memory is still there.
      expect(ctx.memories.list({ scope: 'work' })).toHaveLength(1);
    });

    it('throws NotFoundError when --scope has no retention rule', () => {
      expect(() => ctx.retention.prune({ scope: 'nowhere' })).toThrow(NotFoundError);
    });

    it('cleanly releases vector rows so recall no longer returns expired memories', async () => {
      ctx.retention.set('chat', 3);
      await ctx.memories.remember({ content: 'doomed message about espresso', scope: 'chat' });
      const now = Date.now();
      ctx.db.raw.prepare('UPDATE memories SET created_at = ?').run(now - 100 * DAY);
      ctx.retention.prune({ now });

      const hits = await ctx.memories.recall('espresso', { scope: 'chat' });
      expect(hits).toHaveLength(0);
    });
  });
});
