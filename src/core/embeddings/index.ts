import type { Config } from '../config.js';

import { OllamaEmbeddingProvider } from './ollama.js';
import { OnnxEmbeddingProvider } from './onnx.js';
import type { EmbeddingProvider } from './provider.js';
import { StubEmbeddingProvider } from './stub.js';

export type ProviderKind = 'stub' | 'ollama' | 'onnx';

export interface FactoryOptions {
  kind?: ProviderKind;
  /** Resolved config values. When omitted, only `stub` is safe to construct. */
  config?: Pick<Config, 'embeddings' | 'ollama' | 'onnx'>;
}

export function createEmbeddingProvider(opts: FactoryOptions = {}): EmbeddingProvider {
  const kind = opts.kind ?? opts.config?.embeddings ?? 'stub';
  switch (kind) {
    case 'stub':   return new StubEmbeddingProvider();
    case 'ollama': return new OllamaEmbeddingProvider({
      url: opts.config?.ollama?.url ?? 'http://localhost:11434',
      model: opts.config?.ollama?.model ?? 'nomic-embed-text',
    });
    case 'onnx':   return new OnnxEmbeddingProvider({
      model: opts.config?.onnx?.model ?? 'Xenova/all-MiniLM-L6-v2',
    });
  }
}

export { EmbeddingError } from './provider.js';
export type { EmbeddingProvider } from './provider.js';
export { StubEmbeddingProvider } from './stub.js';
export { OllamaEmbeddingProvider } from './ollama.js';
export { OnnxEmbeddingProvider } from './onnx.js';
