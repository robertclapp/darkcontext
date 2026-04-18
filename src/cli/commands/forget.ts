import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';

export async function runForget(
  id: number,
  opts: CommonCliOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  await withAppContext(opts, (ctx) => {
    const ok = ctx.memories.forget(id);
    out(ok ? `forgot #${id}` : `no memory with id ${id}`);
  });
}

export function registerForget(program: Command): void {
  program
    .command('forget <id>')
    .description('Delete a memory by id')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (id: string, opts: CommonCliOptions) => {
      await runForget(Number(id), opts);
    });
}
