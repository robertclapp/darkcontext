import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runEvals, type EvalCase, type Reporter } from '../harness.js';
import { openDb } from '../../src/core/store/db.js';
import { Memories } from '../../src/core/memories/index.js';
import type { EmbeddingProvider } from '../../src/core/embeddings/index.js';

/**
 * Scope-skew retrieval eval — quantifies the starvation fix.
 *
 * A minority scope's matches must still be retrievable when a different
 * scope dominates the vector neighbourhood of the query. We bury a single
 * `target`-scope memory beneath a wall of nearer `noise`-scope vectors and
 * measure whether scoped recall still finds it.
 *
 * Deterministic by construction: a 1-D provider maps "n:<x>" → [x,…], so
 * distance to the query is exactly |x - queryX| and skew is fully
 * controllable (the stub provider's hashes are not tunable).
 */

class LinearProvider implements EmbeddingProvider {
  readonly name = 'linear-eval';
  readonly dimension = 4;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const m = /(-?\d+(?:\.\d+)?)/.exec(t);
      return [m ? Number(m[1]) : 0, 0, 0, 0];
    });
  }
}

async function measureSkew(report: Reporter, noiseCount: number): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'dcx-skew-'));
  const db = openDb({ path: join(dir, 'store.db') });
  try {
    const mem = new Memories(db, new LinearProvider());
    // Noise cluster strictly nearer the query (x≈0) than the target (x=1).
    for (let i = 0; i < noiseCount; i++) {
      await mem.remember({ content: `n:0.${String(i).padStart(3, '0')}`, scope: 'noise' });
    }
    await mem.remember({ content: 'n:1', scope: 'target' });

    // The target's global nearest-neighbour rank == noiseCount (0-indexed),
    // i.e. it sits behind every noise vector. This is the depth a fixed
    // k=limit window would have to span to even see it.
    report.metric('noise_in_nearer_scope', noiseCount);
    report.metric('target_global_rank', noiseCount + 1);

    const limit = 5;
    const hits = await mem.recall('n:0', { limit, scope: 'target' });
    const found = hits.some((h) => h.memory.content === 'n:1');
    report.metric('limit', limit);
    report.metric('recall_at_limit', found ? 1 : 0);
    // The whole point: a tiny window must still surface the buried match.
    report.assert('target_recalled_despite_skew', found ? 1 : 0, '==', 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const cases: EvalCase[] = [
  { name: 'scope skew 50:1 — minority scope still recalled at limit 5', run: (r) => measureSkew(r, 50) },
  { name: 'scope skew 500:1 — minority scope still recalled at limit 5', run: (r) => measureSkew(r, 500) },
];

await runEvals(cases);
