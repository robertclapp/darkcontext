import type { Command } from 'commander';

import { buildContext } from '../context.js';

export function registerList(program: Command): void {
  program
    .command('list')
    .description('List stored memories (newest first)')
    .option('--limit <n>', 'max results', (v) => Number(v), 50)
    .option('--scope <scope>', 'restrict to a scope')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action((opts: { limit: number; scope?: string; db?: string; provider?: string }) => {
      const ctx = buildContext(opts);
      try {
        const memories = ctx.memories.list({
          limit: opts.limit,
          ...(opts.scope ? { scope: opts.scope } : {}),
        });
        if (memories.length === 0) {
          console.log('(no memories)');
          return;
        }
        for (const m of memories) {
          console.log(`#${m.id} [${m.scope ?? '-'}] ${m.content}`);
        }
      } finally {
        ctx.close();
      }
    });
}
