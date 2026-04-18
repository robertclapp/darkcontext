import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';
import { ValidationError } from '../../core/errors.js';

export interface RememberOptions extends CommonCliOptions {
  kind: string;
  scope?: string;
  tags?: string;
  source?: string;
}

export async function runRemember(
  content: string,
  opts: RememberOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  if (!content.trim()) throw new ValidationError('content', 'remember: content is empty');
  await withAppContext(opts, async (ctx) => {
    const memory = await ctx.memories.remember({
      content,
      kind: opts.kind,
      ...(opts.scope ? { scope: opts.scope } : {}),
      tags: parseTags(opts.tags),
      ...(opts.source ? { source: opts.source } : {}),
    });
    out(`#${memory.id} [${memory.scope ?? '-'}] ${memory.content}`);
    if (memory.tags.length) out(`  tags: ${memory.tags.join(', ')}`);
  });
}

export function registerRemember(program: Command): void {
  program
    .command('remember <content...>')
    .description('Store a memory')
    .option('--kind <kind>', 'memory kind (fact, preference, event, ...)', 'fact')
    .option('--scope <scope>', 'scope name (created on demand)')
    .option('--tags <tags>', 'comma-separated tags')
    .option('--source <source>', 'optional source label')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (contentParts: string[], opts: RememberOptions) => {
      await runRemember(contentParts.join(' ').trim(), opts);
    });
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}
