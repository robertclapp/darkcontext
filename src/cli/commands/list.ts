import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { parsePositiveInt, withAppContext } from '../context.js';

export interface ListOptions extends CommonCliOptions {
  limit: number;
  scope?: string;
}

export async function runList(
  opts: ListOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  await withAppContext(opts, (ctx) => {
    const memories = ctx.memories.list({
      limit: opts.limit,
      ...(opts.scope ? { scope: opts.scope } : {}),
    });
    if (memories.length === 0) {
      out('(no memories)');
      return;
    }
    for (const m of memories) out(`#${m.id} [${m.scope ?? '-'}] ${m.content}`);
  });
}

export function registerList(program: Command): void {
  program
    .command('list')
    .description('List stored memories (newest first)')
    .option('--limit <n>', 'max results', parsePositiveInt('limit'), 50)
    .option('--scope <scope>', 'restrict to a scope')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (opts: ListOptions) => {
      await runList(opts);
    });
}
