import { createHash } from 'node:crypto';

import { STUB_EMBED_DIM } from '../constants.js';

import type { EmbeddingProvider } from './provider.js';

/**
 * Deterministic, dependency-free embedding provider. NOT semantic — it hashes
 * tokens into a fixed-dim vector. Used as the default in dev/tests so the full
 * recall path can run without Ollama or ONNX installed. Swap to `ollama` or
 * `onnx` for real semantic search.
 */
export class StubEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'stub';
  readonly dimension: number;

  constructor(dimension = STUB_EMBED_DIM) {
    if (!Number.isInteger(dimension) || dimension <= 0) {
      throw new RangeError(`Stub embedding dimension must be a positive integer, got: ${dimension}`);
    }
    this.dimension = dimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vectorize(t));
  }

  private vectorize(text: string): number[] {
    const v = new Array<number>(this.dimension).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    for (const tok of tokens) {
      const h = createHash('sha256').update(tok).digest();
      for (let i = 0; i < this.dimension; i++) {
        const byte = h[i % h.length] ?? 0;
        v[i] = (v[i] ?? 0) + (byte / 255) * 2 - 1;
      }
    }
    return normalize(v);
  }
}

function normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return v.map((x) => x / norm);
}
