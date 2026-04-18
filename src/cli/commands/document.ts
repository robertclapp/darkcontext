import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { parsePositiveInt, withAppContext } from '../context.js';
import { ValidationError } from '../../core/errors.js';

interface DocListOptions extends CommonCliOptions {
  scope?: string;
  limit: number;
}

interface DocSearchOptions extends CommonCliOptions {
  scope?: string;
  limit: number;
}

export async function runDocList(opts: DocListOptions, out: (l: string) => void = console.log): Promise<void> {
  await withAppContext(opts, (ctx) => {
    const docs = ctx.documents.list({
      limit: opts.limit,
      ...(opts.scope ? { scope: opts.scope } : {}),
    });
    if (docs.length === 0) return out('(no documents)');
    for (const d of docs) out(`#${d.id} [${d.scope ?? '-'}] ${d.title}  (${d.mime})`);
  });
}

export async function runDocSearch(
  query: string,
  opts: DocSearchOptions,
  out: (l: string) => void = console.log
): Promise<void> {
  if (!query.trim()) throw new ValidationError('query', 'document search: query is empty');
  await withAppContext(opts, async (ctx) => {
    const hits = await ctx.documents.search(query, {
      limit: opts.limit,
      ...(opts.scope ? { scope: opts.scope } : {}),
    });
    if (hits.length === 0) return out('(no matches)');
    for (const h of hits) {
      out(`[${h.match} ${h.score.toFixed(3)}] ${h.title} [${h.scope ?? '-'}] #${h.chunkIdx}`);
      out(h.content);
      out('');
    }
  });
}

export async function runDocRemove(
  id: number,
  opts: CommonCliOptions,
  out: (l: string) => void = console.log
): Promise<void> {
  await withAppContext(opts, (ctx) => {
    out(ctx.documents.delete(id) ? `removed #${id}` : `no document with id ${id}`);
  });
}

export function registerDocumentCommands(program: Command): void {
  const doc = program
    .command('document')
    .aliases(['doc'])
    .description('Inspect and search documents');

  doc
    .command('list')
    .description('List ingested documents')
    .option('--scope <scope>', 'restrict to a scope')
    .option('--limit <n>', 'max results', parsePositiveInt('limit'), 50)
    .option('--db <path>', 'override database path')
    .action(async (opts: DocListOptions) => runDocList(opts));

  doc
    .command('search <query...>')
    .description('Search document chunks by semantic similarity')
    .option('--scope <scope>', 'restrict to a scope')
    .option('--limit <n>', 'max chunks', parsePositiveInt('limit'), 10)
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (queryParts: string[], opts: DocSearchOptions) =>
      runDocSearch(queryParts.join(' ').trim(), opts)
    );

  doc
    .command('remove <id>')
    .description('Delete a document and its chunks')
    .option('--db <path>', 'override database path')
    .action(async (id: string, opts: CommonCliOptions) => runDocRemove(Number(id), opts));
}
