import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { openDb } from '../../core/store/db.js';
import { Documents } from '../../core/documents/index.js';
import { createEmbeddingProvider, resolveProviderKind } from '../../core/embeddings/index.js';

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
    .action(
      async (
        path: string,
        opts: {
          title?: string;
          scope?: string;
          mime: string;
          chunkSize: number;
          chunkOverlap: number;
          db?: string;
          provider?: string;
        }
      ) => {
        const abs = resolve(path);
        const content = readFileSync(abs, 'utf8');
        const db = openDb(opts.db ? { path: opts.db } : {});
        try {
          const documents = new Documents(
            db,
            createEmbeddingProvider(resolveProviderKind(opts.provider))
          );
          const res = await documents.ingest(
            {
              title: opts.title ?? basename(abs),
              content,
              sourceUri: `file://${abs}`,
              mime: opts.mime,
              ...(opts.scope ? { scope: opts.scope } : {}),
            },
            { size: opts.chunkSize, overlap: opts.chunkOverlap }
          );
          console.log(
            `#${res.document.id} [${res.document.scope ?? '-'}] ${res.document.title} — ${res.chunks} chunks`
          );
        } finally {
          db.close();
        }
      }
    );
}
