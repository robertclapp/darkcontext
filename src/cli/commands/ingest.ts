import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CommonCliOptions } from '../context.js';
import { parsePositiveInt, withAppContext } from '../context.js';
import { DEFAULT_CHUNK_OVERLAP, DEFAULT_CHUNK_SIZE } from '../../core/constants.js';
import { ValidationError } from '../../core/errors.js';

export interface IngestOptions extends CommonCliOptions {
  title?: string;
  scope?: string;
  mime: string;
  chunkSize: number;
  chunkOverlap: number;
}

export async function runIngest(
  path: string,
  opts: IngestOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  // Commander already validated each value is a positive integer via
  // parsePositiveInt; cross-field invariants live here.
  if (opts.chunkOverlap >= opts.chunkSize) {
    throw new ValidationError(
      'chunk-overlap',
      `must be smaller than chunk-size (got overlap=${opts.chunkOverlap}, size=${opts.chunkSize})`
    );
  }
  const abs = resolve(path);
  const content = readFileSync(abs, 'utf8');
  await withAppContext(opts, async (ctx) => {
    const res = await ctx.documents.ingest(
      {
        title: opts.title ?? basename(abs),
        content,
        // pathToFileURL handles Windows drive letters, spaces, and
        // percent-encoding; string concatenation produces broken URIs.
        sourceUri: pathToFileURL(abs).href,
        mime: opts.mime,
        ...(opts.scope ? { scope: opts.scope } : {}),
      },
      { size: opts.chunkSize, overlap: opts.chunkOverlap }
    );
    out(`#${res.document.id} [${res.document.scope ?? '-'}] ${res.document.title} — ${res.chunks} chunks`);
  });
}

export function registerIngest(program: Command): void {
  program
    .command('ingest <path>')
    .description('Ingest a document from a local file (chunked, embedded, and stored)')
    .option('--title <title>', 'override document title (default: filename)')
    .option('--scope <scope>', 'scope to ingest into (created on demand)')
    .option('--mime <mime>', 'MIME type', 'text/plain')
    .option('--chunk-size <n>', 'characters per chunk', parsePositiveInt('chunk-size'), DEFAULT_CHUNK_SIZE)
    .option('--chunk-overlap <n>', 'chunk overlap characters', parsePositiveInt('chunk-overlap'), DEFAULT_CHUNK_OVERLAP)
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (path: string, opts: IngestOptions) => {
      await runIngest(path, opts);
    });
}
