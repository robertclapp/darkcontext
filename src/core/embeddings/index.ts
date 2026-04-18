import { OllamaEmbeddingProvider } from './ollama.js';
import { OnnxEmbeddingProvider } from './onnx.js';
import type { EmbeddingProvider } from './provider.js';
import { StubEmbeddingProvider } from './stub.js';

export type ProviderKind = 'stub' | 'ollama' | 'onnx';

export function resolveProviderKind(raw?: string): ProviderKind {
  const v = (raw ?? process.env.DARKCONTEXT_EMBEDDINGS ?? 'stub').toLowerCase();
  if (v === 'ollama' || v === 'onnx' || v === 'stub') return v;
  throw new Error(`Unknown embeddings provider: ${v}`);
}

export function createEmbeddingProvider(kind?: ProviderKind): EmbeddingProvider {
  const k = kind ?? resolveProviderKind();
  switch (k) {
    case 'ollama': return new OllamaEmbeddingProvider();
    case 'onnx':   return new OnnxEmbeddingProvider();
    case 'stub':   return new StubEmbeddingProvider();
  }
}

export { EmbeddingError } from './provider.js';
export type { EmbeddingProvider } from './provider.js';
export { StubEmbeddingProvider } from './stub.js';
export { OllamaEmbeddingProvider } from './ollama.js';
export { OnnxEmbeddingProvider } from './onnx.js';
