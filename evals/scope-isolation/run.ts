import { openEvalContext, runEvals, type EvalCase, type Reporter } from '../harness.js';
import { ScopeFilter } from '../../src/mcp/scopeFilter.js';
import type { ToolWithGrants } from '../../src/core/tools/index.js';

/**
 * Scope isolation eval.
 *
 * An MCP tool B with the grant set `{ bob: rw }` must NOT be able to:
 *   1. See any memory / document / conversation / workspace written by
 *      tool A into `alice`-scoped resources.
 *   2. Discover Alice's memory IDs by enumerating `forget(id)` (the
 *      existence-leak test).
 *   3. Cause an error that distinguishes "empty readable scopes" from
 *      "id exists but not yours" on `recall` or `search_*`.
 *   4. Write anything into a scope it wasn't granted.
 *
 * Unlike unit tests, this eval is organized around an *attacker model*.
 * Each adversarial pattern is a named case and contributes to pass/fail.
 * Adding new attack vectors means appending to `cases` below.
 */

function grants(...gs: Array<{ scope: string; r: boolean; w: boolean }>): ToolWithGrants {
  return {
    id: 1,
    name: 'eval-bob',
    createdAt: Date.now(),
    lastSeenAt: null,
    grants: gs.map((g) => ({ scope: g.scope, canRead: g.r, canWrite: g.w })),
  };
}

async function seedAlice(ctx: Awaited<ReturnType<typeof openEvalContext>>['ctx']): Promise<number[]> {
  const aliceMems = [
    await ctx.memories.remember({ content: 'alice-secret-passphrase-deadbeef', scope: 'alice' }),
    await ctx.memories.remember({ content: 'credit card 4242-4242-4242-4242', scope: 'alice' }),
  ];
  await ctx.documents.ingest({ title: 'Alice Doc', content: 'Alice confidential plan.', scope: 'alice' });
  await ctx.conversations.ingest('generic', [
    {
      externalId: 'a1',
      title: 'Alice Chat',
      startedAt: 1_700_000_000_000,
      messages: [{ role: 'user', content: 'alice-confidential-message', ts: 1_700_000_000_000 }],
    },
  ], { scope: 'alice' });
  ctx.workspaces.create({ name: 'alice-ws', scope: 'alice' });
  return aliceMems.map((m) => m.id);
}

const cases: EvalCase[] = [
  {
    name: 'recall cannot surface alice-scoped memories for a bob-only tool',
    run: async (r: Reporter) => {
      const { ctx, close } = openEvalContext();
      try {
        await seedAlice(ctx);
        const filter = new ScopeFilter(grants({ scope: 'bob', r: true, w: true }), ctx);
        const hits = await filter.recall('passphrase credit card', { limit: 20 });
        r.metric('hits_leaked', hits.length);
        r.assert('recall_hits_leaked', hits.length, '==', 0);
      } finally {
        close();
      }
    },
  },
  {
    name: 'search_documents cannot surface alice-scoped chunks',
    run: async (r) => {
      const { ctx, close } = openEvalContext();
      try {
        await seedAlice(ctx);
        const filter = new ScopeFilter(grants({ scope: 'bob', r: true, w: true }), ctx);
        const hits = await filter.searchDocuments('confidential plan', { limit: 20 });
        r.metric('doc_hits_leaked', hits.length);
        r.assert('doc_hits_leaked', hits.length, '==', 0);
      } finally {
        close();
      }
    },
  },
  {
    name: 'search_history cannot surface alice-scoped messages',
    run: async (r) => {
      const { ctx, close } = openEvalContext();
      try {
        await seedAlice(ctx);
        const filter = new ScopeFilter(grants({ scope: 'bob', r: true, w: true }), ctx);
        const hits = await filter.searchHistory('confidential', { limit: 20 });
        r.metric('history_hits_leaked', hits.length);
        r.assert('history_hits_leaked', hits.length, '==', 0);
      } finally {
        close();
      }
    },
  },
  {
    name: 'forget enumeration cannot distinguish hit from miss on alice scope',
    run: async (r) => {
      const { ctx, close } = openEvalContext();
      try {
        const aliceIds = await seedAlice(ctx);
        const filter = new ScopeFilter(grants({ scope: 'bob', r: true, w: true }), ctx);

        // Call forget for IDs that exist (Alice-scoped) and IDs that don't.
        let hitsExisted = 0;
        let hitsAbsent = 0;
        for (const id of aliceIds) if (filter.forget(id)) hitsExisted++;
        for (const id of [99999, 100000, 100001]) if (filter.forget(id)) hitsAbsent++;
        r.metric('forget_returned_true_for_alice_ids', hitsExisted);
        r.metric('forget_returned_true_for_nonexistent_ids', hitsAbsent);
        r.assert('forget_no_existence_leak', hitsExisted, '==', 0);
      } finally {
        close();
      }
    },
  },
  {
    name: 'list_workspaces returns zero workspaces for a bob-only tool',
    run: async (r) => {
      const { ctx, close } = openEvalContext();
      try {
        await seedAlice(ctx);
        const filter = new ScopeFilter(grants({ scope: 'bob', r: true, w: true }), ctx);
        const ws = filter.listWorkspaces();
        r.metric('workspaces_leaked', ws.length);
        r.assert('workspaces_leaked', ws.length, '==', 0);
      } finally {
        close();
      }
    },
  },
  {
    name: 'explicit read of alice scope from bob is rejected',
    run: async (r) => {
      const { ctx, close } = openEvalContext();
      try {
        await seedAlice(ctx);
        const filter = new ScopeFilter(grants({ scope: 'bob', r: true, w: true }), ctx);
        let rejected = 0;
        try {
          await filter.recall('anything', { scope: 'alice' });
        } catch {
          rejected++;
        }
        r.metric('explicit_read_rejected', rejected);
        r.assert('explicit_read_rejected', rejected, '==', 1);
      } finally {
        close();
      }
    },
  },
  {
    name: 'write to alice from bob is rejected without writing',
    run: async (r) => {
      const { ctx, close } = openEvalContext();
      try {
        await seedAlice(ctx);
        const filter = new ScopeFilter(grants({ scope: 'bob', r: true, w: true }), ctx);
        let rejected = 0;
        try {
          await filter.remember({ content: 'injected by bob', scope: 'alice' });
        } catch {
          rejected++;
        }
        const aliceAfter = ctx.memories.list({ scope: 'alice' });
        r.metric('alice_memories_after_attack', aliceAfter.length);
        r.assert('write_rejected', rejected, '==', 1);
        // Seeded count is 2; an injected row would bump it to 3.
        r.assert('alice_memories_after_attack', aliceAfter.length, '==', 2);
      } finally {
        close();
      }
    },
  },
  {
    name: 'tool with zero readable scopes sees nothing, raises nothing',
    run: async (r) => {
      const { ctx, close } = openEvalContext();
      try {
        await seedAlice(ctx);
        const filter = new ScopeFilter(grants({ scope: 'bob', r: false, w: true }), ctx);
        const mem = await filter.recall('anything');
        const docs = await filter.searchDocuments('anything');
        const hist = await filter.searchHistory('anything');
        r.metric('mem_hits', mem.length);
        r.metric('doc_hits', docs.length);
        r.metric('history_hits', hist.length);
        r.assert('no_hits_when_unreadable', mem.length + docs.length + hist.length, '==', 0);
      } finally {
        close();
      }
    },
  },
];

await runEvals(cases);
