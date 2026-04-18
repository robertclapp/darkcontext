import type { Command } from 'commander';

import { buildContext } from '../context.js';

export function registerForget(program: Command): void {
  program
    .command('forget <id>')
    .description('Delete a memory by id')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action((id: string, opts: { db?: string; provider?: string }) => {
      const ctx = buildContext(opts);
      try {
        const ok = ctx.memories.forget(Number(id));
        console.log(ok ? `forgot #${id}` : `no memory with id ${id}`);
      } finally {
        ctx.close();
      }
    });
}
