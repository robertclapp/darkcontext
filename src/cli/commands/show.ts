import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { parsePositiveInt, withAppContext } from '../context.js';

/**
 * Print a single memory row in a human-readable block. Useful when a
 * recall hit gives you an `id` but you want the full record (tags,
 * timestamps, source) without re-running the search.
 */
export async function runShow(
  id: number,
  opts: CommonCliOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  await withAppContext(opts, (ctx) => {
    // getById throws NotFoundError, which bubbles up to the CLI's
    // top-level handler as EX_NOINPUT (66). No need to catch here.
    const m = ctx.memories.getById(id);
    const created = new Date(m.createdAt).toISOString();
    const updated = new Date(m.updatedAt).toISOString();
    out(`#${m.id} [${m.scope ?? '-'}] ${m.kind}`);
    out(`  created: ${created}`);
    if (m.updatedAt !== m.createdAt) out(`  updated: ${updated}`);
    if (m.source) out(`  source:  ${m.source}`);
    if (m.tags.length) out(`  tags:    ${m.tags.join(', ')}`);
    out('');
    out(m.content);
  });
}

export function registerShow(program: Command): void {
  program
    .command('show <id>')
    .description('Print a stored memory by id (content, tags, scope, timestamps)')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (id: string, opts: CommonCliOptions) => {
      await runShow(parsePositiveInt('id')(id), opts);
    });
}
