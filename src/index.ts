export { openDb } from './core/store/db.js';
export type { DarkContextDb } from './core/store/db.js';
export { defaultDbPath, defaultStoreDir } from './core/store/paths.js';
export { Memories } from './core/memories/index.js';
export type { Memory, NewMemory, RecallHit, RecallOptions } from './core/memories/index.js';
export {
  createEmbeddingProvider,
  resolveProviderKind,
  StubEmbeddingProvider,
  OllamaEmbeddingProvider,
  OnnxEmbeddingProvider,
} from './core/embeddings/index.js';
export type { EmbeddingProvider, ProviderKind } from './core/embeddings/index.js';
