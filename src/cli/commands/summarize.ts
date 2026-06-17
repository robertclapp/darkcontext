import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { parsePositiveInt, withAppContext } from '../context.js';
import { ValidationError } from '../../core/errors.js';

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
  // Trim + reject empty `--scope` / `--source` explicitly. With a truthy
  // check, `--scope "$EMPTY"` would silently widen the summary to *all*
  // scopes — the same family of footgun as the export/prune empty-scope
  // bug. Treat the flag-was-passed case as a definite intent and fail.
  const scope = opts.scope !== undefined ? opts.scope.trim() : undefined;
  if (scope === '') throw new ValidationError('scope', '--scope must be a non-empty string');
  const source = opts.source !== undefined ? opts.source.trim() : undefined;
  if (source === '') throw new ValidationError('source', '--source must be a non-empty string');

  await withAppContext(opts, async (ctx) => {
    const result = await ctx.summarize.run({
      topic,
      ...(scope !== undefined ? { scope } : {}),
      ...(source !== undefined ? { source } : {}),
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
    .option('--limit <n>', 'history messages to feed the LLM (1..100, default 20)', parsePositiveInt('--limit'))
    .option('--max-tokens <n>', 'soft cap on output tokens (default 400)', parsePositiveInt('--max-tokens'))
    .option('--save', 'persist the summary as a memory in the same scope (kind=summary)', false)
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (topicParts: string[], opts: SummarizeOptions) => {
      await runSummarize(topicParts.join(' ').trim(), opts);
    });
}
