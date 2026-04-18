import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AppContext } from '../../src/core/context.js';

/**
 * Test fixture: a temp-dir `AppContext` using the deterministic stub
 * embedding provider. The helper exposes the ctx plus shortcut fields
 * for every domain so tests read `fx.memories.recall(...)` rather than
 * `fx.ctx.memories.recall(...)`. The ctx itself is available as `fx.ctx`
 * for tests that need context-level APIs (config, newAuditLog, etc.).
 *
 * Adding a new domain: add it to AppContext; expose a shortcut here if
 * many tests will touch it.
 */
export interface Fixture {
  readonly ctx: AppContext;
  readonly dir: string;
  readonly cleanup: () => void;

  // shortcut accessors
  readonly db: AppContext['db'];
  readonly memories: AppContext['memories'];
  readonly documents: AppContext['documents'];
  readonly workspaces: AppContext['workspaces'];
  readonly conversations: AppContext['conversations'];
  readonly scopes: AppContext['scopes'];
  readonly tools: AppContext['tools'];
}

export function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'dcx-test-'));
  const ctx = AppContext.open({ dbPath: join(dir, 'store.db'), embeddings: 'stub' });
  return {
    ctx,
    dir,
    cleanup: () => {
      ctx.close();
      rmSync(dir, { recursive: true, force: true });
    },
    get db() { return ctx.db; },
    get memories() { return ctx.memories; },
    get documents() { return ctx.documents; },
    get workspaces() { return ctx.workspaces; },
    get conversations() { return ctx.conversations; },
    get scopes() { return ctx.scopes; },
    get tools() { return ctx.tools; },
  };
}
