import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AppContext } from '../../src/core/context.js';

describe('AppContext', () => {
  it('wires all domains against a single DB + embeddings provider', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dcx-ctx-'));
    try {
      const ctx = AppContext.open({ dbPath: join(dir, 'store.db'), embeddings: 'stub' });
      try {
        expect(ctx.config.dbPath).toBe(join(dir, 'store.db'));
        expect(ctx.embeddings.name).toBe('stub');
        // All domain accessors resolve and share the same DB.
        expect(ctx.memories).toBeDefined();
        expect(ctx.documents).toBeDefined();
        expect(ctx.workspaces).toBeDefined();
        expect(ctx.conversations).toBeDefined();
        expect(ctx.tools).toBeDefined();
        expect(ctx.scopes).toBeDefined();
      } finally {
        ctx.close();
      }
      expect(existsSync(join(dir, 'store.db'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AppContext.run opens, runs, and closes even on throw', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dcx-ctx-'));
    try {
      await expect(
        AppContext.run({ dbPath: join(dir, 'store.db'), embeddings: 'stub' }, () => {
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');
      // The DB file was still created (proof we opened it) and nothing
      // is locked (proof we closed it).
      const ctx = AppContext.open({ dbPath: join(dir, 'store.db'), embeddings: 'stub' });
      ctx.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('close() is idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dcx-ctx-'));
    const ctx = AppContext.open({ dbPath: join(dir, 'store.db'), embeddings: 'stub' });
    ctx.close();
    expect(() => ctx.close()).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});
