import type { Command } from 'commander';

import { buildContext } from '../context.js';

export function registerRecall(program: Command): void {
  program
    .command('recall <query...>')
    .description('Search memories (vector if available, keyword fallback)')
    .option('--limit <n>', 'max results', (v) => Number(v), 10)
    .option('--scope <scope>', 'restrict to a scope')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(
      async (
        queryParts: string[],
        opts: { limit: number; scope?: string; db?: string; provider?: string }
      ) => {
        const query = queryParts.join(' ').trim();
        if (!query) throw new Error('recall: query is empty');
        const ctx = buildContext(opts);
        try {
          const hits = await ctx.memories.recall(query, {
            limit: opts.limit,
            ...(opts.scope ? { scope: opts.scope } : {}),
          });
          if (hits.length === 0) {
            console.log('(no matches)');
            return;
          }
          for (const h of hits) {
            const score = h.score.toFixed(3);
            console.log(`[${h.match} ${score}] #${h.memory.id} [${h.memory.scope ?? '-'}] ${h.memory.content}`);
          }
        } finally {
          ctx.close();
        }
      }
    );
}
