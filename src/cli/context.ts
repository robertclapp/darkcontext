import { openDb, type DarkContextDb } from '../core/store/db.js';
import { createEmbeddingProvider, resolveProviderKind } from '../core/embeddings/index.js';
import type { EmbeddingProvider, ProviderKind } from '../core/embeddings/index.js';
import { Memories } from '../core/memories/index.js';

export interface CliOptions {
  db?: string;
  provider?: string;
}

export interface CliContext {
  db: DarkContextDb;
  embeddings: EmbeddingProvider;
  memories: Memories;
  close(): void;
}

export function buildContext(opts: CliOptions = {}): CliContext {
  const kind: ProviderKind = resolveProviderKind(opts.provider);
  const embeddings = createEmbeddingProvider(kind);
  const db = openDb(opts.db ? { path: opts.db } : {});
  const memories = new Memories(db, embeddings);
  return {
    db,
    embeddings,
    memories,
    close: () => db.close(),
  };
}
