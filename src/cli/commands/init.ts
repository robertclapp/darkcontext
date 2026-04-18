import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';

export async function runInit(opts: CommonCliOptions, out: (line: string) => void = console.log): Promise<void> {
  await withAppContext(opts, (ctx) => {
    out(`DarkContext store ready at: ${ctx.config.dbPath}`);
    out(`  embeddings provider: ${ctx.embeddings.name}`);
    out(`  sqlite-vec:          ${ctx.db.hasVec ? 'loaded' : 'unavailable (keyword fallback)'}`);
    if (ctx.db.embedDim > 0) out(`  embed dim:           ${ctx.db.embedDim}`);
  });
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Initialize the DarkContext store (creates ~/.darkcontext/store.db)')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (opts: CommonCliOptions) => {
      await runInit(opts);
    });
}
