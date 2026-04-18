import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';

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
    .option('--chunk-size <n>', 'characters per chunk', (v) => Number(v), 1200)
    .option('--chunk-overlap <n>', 'chunk overlap characters', (v) => Number(v), 150)
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (path: string, opts: IngestOptions) => {
      await runIngest(path, opts);
    });
}
