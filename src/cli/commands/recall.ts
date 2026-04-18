import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { parsePositiveInt, withAppContext } from '../context.js';
import { ValidationError } from '../../core/errors.js';

export interface RecallOptions extends CommonCliOptions {
  limit: number;
  scope?: string;
}

export async function runRecall(
  query: string,
  opts: RecallOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  if (!query.trim()) throw new ValidationError('query', 'recall: query is empty');
  await withAppContext(opts, async (ctx) => {
    const hits = await ctx.memories.recall(query, {
      limit: opts.limit,
      ...(opts.scope ? { scope: opts.scope } : {}),
    });
    if (hits.length === 0) {
      out('(no matches)');
      return;
    }
    for (const h of hits) {
      out(`[${h.match} ${h.score.toFixed(3)}] #${h.memory.id} [${h.memory.scope ?? '-'}] ${h.memory.content}`);
    }
  });
}

export function registerRecall(program: Command): void {
  program
    .command('recall <query...>')
    .description('Search memories (vector if available, keyword fallback)')
    .option('--limit <n>', 'max results', parsePositiveInt('limit'), 10)
    .option('--scope <scope>', 'restrict to a scope')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (queryParts: string[], opts: RecallOptions) => {
      await runRecall(queryParts.join(' ').trim(), opts);
    });
}
