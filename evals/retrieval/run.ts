import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runEvals, openEvalContext, type EvalCase, type Reporter } from '../harness.js';

/**
 * Retrieval quality evaluation.
 *
 * Loads a curated set of memories plus labeled queries, writes them into
 * a fresh store, and measures how often the expected memory is in the
 * top-k recall hits for each query. We run the eval with:
 *
 *   - the default stub provider (fast, deterministic, bad signal but
 *     non-zero because of the overlap between lexical FTS5 and the stub
 *     hash — sets a floor for the system under test);
 *   - Ollama if `OLLAMA_URL` + `OLLAMA_EMBED_MODEL` are reachable
 *     (skipped otherwise so dev loops don't need it running).
 *
 * The pass bar is intentionally conservative so the stub provider can
 * still clear it: recall@5 >= 80% on a 10-query set. Ollama should score
 * much higher and we record the difference for operators.
 */

interface Dataset {
  memories: Array<{ id: string; content: string }>;
  queries: Array<{ text: string; expected: string; topic: string }>;
}

const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), 'dataset.json');
const dataset: Dataset = JSON.parse(readFileSync(DATA_FILE, 'utf8'));

async function measureProvider(providerKind: 'stub' | 'ollama', reporter: Reporter): Promise<void> {
  const { ctx, close } = openEvalContext({ providerKind });
  try {
    // Map label-id (string) → stored memory id (number) so we can compare hits.
    const idMap = new Map<string, number>();
    for (const m of dataset.memories) {
      const row = await ctx.memories.remember({ content: m.content, tags: [m.id] });
      idMap.set(m.id, row.id);
    }

    let hit1 = 0;
    let hit5 = 0;
    let totalLatencyMs = 0;

    for (const q of dataset.queries) {
      const t0 = Date.now();
      const hits = await ctx.memories.recall(q.text, { limit: 5 });
      totalLatencyMs += Date.now() - t0;

      const expectedId = idMap.get(q.expected);
      const positions = hits.map((h) => h.memory.id);
      const pos = expectedId !== undefined ? positions.indexOf(expectedId) : -1;
      if (pos === 0) hit1++;
      if (pos >= 0 && pos < 5) hit5++;
    }

    const n = dataset.queries.length;
    reporter.metric(`${providerKind}.n_queries`, n);
    reporter.metric(`${providerKind}.recall_at_1`, toPct(hit1 / n));
    reporter.metric(`${providerKind}.recall_at_5`, toPct(hit5 / n));
    reporter.metric(`${providerKind}.avg_latency_ms`, Math.round(totalLatencyMs / n));
    reporter.assert(`${providerKind}.recall_at_5_pct`, (hit5 / n) * 100, '>=', 80);
  } finally {
    close();
  }
}

function toPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

const cases: EvalCase[] = [
  {
    name: 'retrieval quality — stub provider (deterministic floor)',
    run: (r) => measureProvider('stub', r),
  },
];

// Opt in to the Ollama eval only when the server is reachable; skip silently
// otherwise so `npm run eval` works out of the box.
if (process.env.OLLAMA_URL || process.env.DARKCONTEXT_EMBEDDINGS === 'ollama') {
  cases.push({
    name: 'retrieval quality — Ollama provider',
    run: async (r) => {
      try {
        await measureProvider('ollama', r);
      } catch (err) {
        r.note(`Ollama unavailable, skipping: ${(err as Error).message}`);
      }
    },
  });
}

await runEvals(cases);
