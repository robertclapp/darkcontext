import type { Command } from 'commander';

import { openDb } from '../../core/store/db.js';
import { Documents } from '../../core/documents/index.js';
import { createEmbeddingProvider, resolveProviderKind } from '../../core/embeddings/index.js';

export function registerDocumentCommands(program: Command): void {
  const doc = program.command('doc').description('Inspect and search documents');

  doc
    .command('list')
    .description('List ingested documents')
    .option('--scope <scope>', 'restrict to a scope')
    .option('--limit <n>', 'max results', (v) => Number(v), 50)
    .option('--db <path>', 'override database path')
    .action((opts: { scope?: string; limit: number; db?: string }) => {
      const db = openDb(opts.db ? { path: opts.db } : {});
      try {
        const provider = createEmbeddingProvider(resolveProviderKind());
        const docs = new Documents(db, provider).list({
          limit: opts.limit,
          ...(opts.scope ? { scope: opts.scope } : {}),
        });
        if (docs.length === 0) return console.log('(no documents)');
        for (const d of docs) console.log(`#${d.id} [${d.scope ?? '-'}] ${d.title}  (${d.mime})`);
      } finally {
        db.close();
      }
    });

  doc
    .command('search <query...>')
    .description('Search document chunks by semantic similarity')
    .option('--scope <scope>', 'restrict to a scope')
    .option('--limit <n>', 'max chunks', (v) => Number(v), 10)
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(
      async (
        queryParts: string[],
        opts: { scope?: string; limit: number; db?: string; provider?: string }
      ) => {
        const query = queryParts.join(' ').trim();
        if (!query) throw new Error('search: query is empty');
        const db = openDb(opts.db ? { path: opts.db } : {});
        try {
          const documents = new Documents(
            db,
            createEmbeddingProvider(resolveProviderKind(opts.provider))
          );
          const hits = await documents.search(query, {
            limit: opts.limit,
            ...(opts.scope ? { scope: opts.scope } : {}),
          });
          if (hits.length === 0) return console.log('(no matches)');
          for (const h of hits) {
            console.log(
              `[${h.match} ${h.score.toFixed(3)}] ${h.title} [${h.scope ?? '-'}] #${h.chunkIdx}`
            );
            console.log(h.content);
            console.log('');
          }
        } finally {
          db.close();
        }
      }
    );

  doc
    .command('remove <id>')
    .description('Delete a document and its chunks')
    .option('--db <path>', 'override database path')
    .action((id: string, opts: { db?: string }) => {
      const db = openDb(opts.db ? { path: opts.db } : {});
      try {
        const docs = new Documents(db, createEmbeddingProvider(resolveProviderKind()));
        const ok = docs.delete(Number(id));
        console.log(ok ? `removed #${id}` : `no document with id ${id}`);
      } finally {
        db.close();
      }
    });
}
