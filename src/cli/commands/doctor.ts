import type { Command } from 'commander';

import { buildContext } from '../context.js';
import { defaultDbPath } from '../../core/store/paths.js';

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check store + embeddings health')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (opts: { db?: string; provider?: string }) => {
      const ctx = buildContext(opts);
      try {
        console.log(`db path:          ${opts.db ?? defaultDbPath()}`);
        console.log(`sqlite-vec:       ${ctx.db.hasVec ? 'ok' : 'MISSING (falling back to keyword search)'}`);
        console.log(`embed dim (stored): ${ctx.db.embedDim || '(none yet)'}`);
        console.log(`provider:         ${ctx.embeddings.name}`);
        try {
          const [v] = await ctx.embeddings.embed(['darkcontext healthcheck']);
          console.log(`embed sample:     ok (dim ${v?.length ?? 0})`);
        } catch (err) {
          console.log(`embed sample:     FAILED — ${(err as Error).message}`);
        }
      } finally {
        ctx.close();
      }
    });
}
