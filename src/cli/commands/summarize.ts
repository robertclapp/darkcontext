import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';

export interface SummarizeOptions extends CommonCliOptions {
  scope?: string;
  source?: string;
  limit?: number;
  maxTokens?: number;
  save?: boolean;
}

export async function runSummarize(
  topic: string,
  opts: SummarizeOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  await withAppContext(opts, async (ctx) => {
    const result = await ctx.summarize.run({
      topic,
      ...(opts.scope ? { scope: opts.scope } : {}),
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
      ...(opts.save ? { save: true } : {}),
    });
    const header =
      `topic: ${result.topic}` +
      ` (scope=${result.scope ?? '-'}` +
      `, source=${result.source ?? '-'}` +
      `, sources=${result.sourceCount}` +
      `, provider=${result.provider})`;
    out(header);
    out(result.summary);
    if (result.savedMemoryId !== null) {
      out(`saved as memory #${result.savedMemoryId}`);
    }
  });
}

export function registerSummarize(program: Command): void {
  program
    .command('summarize <topic...>')
    .description('Summarize relevant conversation history via the configured LLM')
    .option('--scope <scope>', 'restrict retrieval to this scope')
    .option('--source <name>', "filter by importer: 'chatgpt' | 'claude' | 'gemini' | 'generic'")
    .option('--limit <n>', 'history messages to feed the LLM (1..100, default 20)', (v) => Number(v))
    .option('--max-tokens <n>', 'soft cap on output tokens (default 400)', (v) => Number(v))
    .option('--save', 'persist the summary as a memory in the same scope (kind=summary)', false)
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (topicParts: string[], opts: SummarizeOptions) => {
      await runSummarize(topicParts.join(' ').trim(), opts);
    });
}
