import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ScopeFilter, ScopeDeniedError } from '../../src/mcp/scopeFilter.js';
import type { ToolWithGrants } from '../../src/core/tools/index.js';
import { makeFixture, type Fixture } from '../helpers/factory.js';

function fakeTool(name: string, grants: Array<{ scope: string; r: boolean; w: boolean }>): ToolWithGrants {
  return {
    id: 1,
    name,
    createdAt: Date.now(),
    lastSeenAt: null,
    grants: grants.map((g) => ({ scope: g.scope, canRead: g.r, canWrite: g.w })),
  };
}

describe('ScopeFilter — the security boundary', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => fx.cleanup());

  describe('remember', () => {
    it('writes to the scope specified when the tool has write access', async () => {
      const filter = new ScopeFilter(fakeTool('work-tool', [{ scope: 'work', r: true, w: true }]), fx.memories);
      const m = await filter.remember({ content: 'Q2 OKRs', scope: 'work' });
      expect(m.scope).toBe('work');
    });

    it('defaults to the first writable scope when none is given', async () => {
      const filter = new ScopeFilter(
        fakeTool('multi', [
          { scope: 'personal', r: true, w: true },
          { scope: 'work', r: true, w: true },
        ]),
        fx.memories
      );
      const m = await filter.remember({ content: 'no scope given' });
      expect(m.scope).toBe('personal');
    });

    it('rejects writing to an unreadable scope', async () => {
      const filter = new ScopeFilter(fakeTool('ro', [{ scope: 'shared', r: true, w: false }]), fx.memories);
      await expect(filter.remember({ content: 'nope', scope: 'shared' })).rejects.toBeInstanceOf(ScopeDeniedError);
    });

    it('rejects writing to a scope the tool was not granted at all', async () => {
      const filter = new ScopeFilter(fakeTool('t', [{ scope: 'a', r: true, w: true }]), fx.memories);
      await expect(filter.remember({ content: 'x', scope: 'b' })).rejects.toBeInstanceOf(ScopeDeniedError);
    });

    it('rejects writing when the tool has zero writable scopes', async () => {
      const filter = new ScopeFilter(fakeTool('reader', [{ scope: 'shared', r: true, w: false }]), fx.memories);
      await expect(filter.remember({ content: 'x' })).rejects.toBeInstanceOf(ScopeDeniedError);
    });
  });

  describe('recall', () => {
    it('only returns memories from readable scopes when scope is omitted', async () => {
      await fx.memories.remember({ content: 'personal secret', scope: 'personal' });
      await fx.memories.remember({ content: 'work policy', scope: 'work' });

      const filter = new ScopeFilter(fakeTool('work-only', [{ scope: 'work', r: true, w: false }]), fx.memories);
      const hits = await filter.recall('secret policy');
      const scopes = new Set(hits.map((h) => h.memory.scope));
      expect(scopes).not.toContain('personal');
      expect(hits.some((h) => h.memory.scope === 'work')).toBe(true);
    });

    it('returns empty when the tool has no readable scopes', async () => {
      await fx.memories.remember({ content: 'anything', scope: 'work' });
      const filter = new ScopeFilter(fakeTool('blind', [{ scope: 'work', r: false, w: true }]), fx.memories);
      expect(await filter.recall('anything')).toEqual([]);
    });

    it('rejects an explicit scope outside the tool grants', async () => {
      const filter = new ScopeFilter(fakeTool('t', [{ scope: 'work', r: true, w: true }]), fx.memories);
      await expect(filter.recall('q', { scope: 'personal' })).rejects.toBeInstanceOf(ScopeDeniedError);
    });

    it('respects an explicit readable scope', async () => {
      await fx.memories.remember({ content: 'work thing', scope: 'work' });
      await fx.memories.remember({ content: 'personal thing', scope: 'personal' });
      const filter = new ScopeFilter(
        fakeTool('both', [
          { scope: 'work', r: true, w: true },
          { scope: 'personal', r: true, w: true },
        ]),
        fx.memories
      );
      const hits = await filter.recall('thing', { scope: 'work' });
      expect(hits.every((h) => h.memory.scope === 'work')).toBe(true);
    });
  });

  describe('forget', () => {
    it('deletes a memory in a writable scope', async () => {
      const m = await fx.memories.remember({ content: 'kill me', scope: 'work' });
      const filter = new ScopeFilter(fakeTool('t', [{ scope: 'work', r: true, w: true }]), fx.memories);
      expect(filter.forget(m.id)).toBe(true);
    });

    it('silently refuses to delete memories outside writable scopes (does not leak existence)', async () => {
      const m = await fx.memories.remember({ content: 'protected', scope: 'personal' });
      const filter = new ScopeFilter(fakeTool('t', [{ scope: 'work', r: true, w: true }]), fx.memories);
      expect(filter.forget(m.id)).toBe(false);
      // The memory must still exist.
      expect(fx.memories.getById(m.id).content).toBe('protected');
    });

    it('returns false for non-existent ids without throwing', async () => {
      const filter = new ScopeFilter(fakeTool('t', [{ scope: 'work', r: true, w: true }]), fx.memories);
      expect(filter.forget(99999)).toBe(false);
    });

    it('refuses to delete when tool only has read access on the scope', async () => {
      const m = await fx.memories.remember({ content: 'ro', scope: 'shared' });
      const filter = new ScopeFilter(fakeTool('reader', [{ scope: 'shared', r: true, w: false }]), fx.memories);
      expect(filter.forget(m.id)).toBe(false);
      expect(fx.memories.getById(m.id).content).toBe('ro');
    });
  });

  describe('scope isolation across multiple tools', () => {
    it('two tools with disjoint scopes cannot see each others memories', async () => {
      const alice = new ScopeFilter(fakeTool('alice', [{ scope: 'alice-scope', r: true, w: true }]), fx.memories);
      const bob = new ScopeFilter(fakeTool('bob', [{ scope: 'bob-scope', r: true, w: true }]), fx.memories);

      await alice.remember({ content: 'alice-only secret', scope: 'alice-scope' });
      await bob.remember({ content: 'bob-only secret', scope: 'bob-scope' });

      const aliceHits = await alice.recall('secret');
      const bobHits = await bob.recall('secret');

      expect(aliceHits.every((h) => h.memory.scope === 'alice-scope')).toBe(true);
      expect(bobHits.every((h) => h.memory.scope === 'bob-scope')).toBe(true);
      expect(aliceHits.some((h) => h.memory.content.includes('bob-only'))).toBe(false);
      expect(bobHits.some((h) => h.memory.content.includes('alice-only'))).toBe(false);
    });
  });
});
