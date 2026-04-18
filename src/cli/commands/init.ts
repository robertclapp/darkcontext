import type { Command } from 'commander';

import { buildContext } from '../context.js';
import { defaultDbPath } from '../../core/store/paths.js';

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Initialize the DarkContext store (creates ~/.darkcontext/store.db)')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action((opts: { db?: string; provider?: string }) => {
      const ctx = buildContext(opts);
      try {
        const path = opts.db ?? defaultDbPath();
        console.log(`DarkContext store ready at: ${path}`);
        console.log(`  embeddings provider: ${ctx.embeddings.name}`);
        console.log(`  sqlite-vec:          ${ctx.db.hasVec ? 'loaded' : 'unavailable (keyword fallback)'}`);
        if (ctx.db.embedDim > 0) console.log(`  embed dim:           ${ctx.db.embedDim}`);
      } finally {
        ctx.close();
      }
    });
}
