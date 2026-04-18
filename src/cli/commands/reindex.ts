import type { Command } from 'commander';

import { openDb } from '../../core/store/db.js';
import { Memories } from '../../core/memories/index.js';
import { Documents } from '../../core/documents/index.js';
import { Conversations } from '../../core/conversations/index.js';
import { createEmbeddingProvider, resolveProviderKind } from '../../core/embeddings/index.js';
import { defaultDbPath } from '../../core/store/paths.js';

export function registerReindex(program: Command): void {
  program
    .command('reindex')
    .description(
      'Rebuild vector indexes (memories, document chunks, messages) from stored content. Use after swapping embedding providers or to recover vectors that failed to write during ingest.'
    )
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .option('--only <kinds>', 'comma-separated subset: memories,documents,history (default: all)')
    .action(
      async (opts: { db?: string; provider?: string; only?: string }) => {
        const provider = createEmbeddingProvider(resolveProviderKind(opts.provider));
        const db = openDb(opts.db ? { path: opts.db } : {});
        try {
          if (!db.hasVec) {
            console.error('sqlite-vec is not loaded — reindex is a no-op. Install the sqlite-vec native binary.');
            process.exit(2);
          }
          const want = parseOnly(opts.only);
          console.log(`reindexing ${want.join(', ')} via ${provider.name} at ${opts.db ?? defaultDbPath()}`);

          if (want.includes('memories')) {
            const n = await new Memories(db, provider).reindex();
            console.log(`  memories: ${n} rows`);
          }
          if (want.includes('documents')) {
            const n = await new Documents(db, provider).reindex();
            console.log(`  document_chunks: ${n} rows`);
          }
          if (want.includes('history')) {
            const n = await new Conversations(db, provider).reindex();
            console.log(`  messages: ${n} rows`);
          }
        } finally {
          db.close();
        }
      }
    );
}

function parseOnly(raw: string | undefined): Array<'memories' | 'documents' | 'history'> {
  const all: Array<'memories' | 'documents' | 'history'> = ['memories', 'documents', 'history'];
  if (!raw) return all;
  const names = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const out: Array<'memories' | 'documents' | 'history'> = [];
  for (const name of names) {
    if (name === 'memories' || name === 'documents' || name === 'history') {
      out.push(name);
    } else {
      throw new Error(`unknown --only kind: ${name} (expected memories | documents | history)`);
    }
  }
  return out;
}
