import { describe, it, expect } from 'vitest';

import { StubEmbeddingProvider } from '../../src/core/embeddings/stub.js';
import { createEmbeddingProvider } from '../../src/core/embeddings/index.js';

describe('StubEmbeddingProvider', () => {
  it('produces unit-norm vectors of the requested dimension', async () => {
    const p = new StubEmbeddingProvider(64);
    const [v] = await p.embed(['hello world']);
    expect(v).toBeDefined();
    expect(v!.length).toBe(64);
    const norm = Math.sqrt(v!.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it('is deterministic for the same input', async () => {
    const p = new StubEmbeddingProvider();
    const [a] = await p.embed(['the quick brown fox']);
    const [b] = await p.embed(['the quick brown fox']);
    expect(a).toEqual(b);
  });

  it('differs between unrelated inputs', async () => {
    const p = new StubEmbeddingProvider();
    const [a, b] = await p.embed(['coffee descale monthly', 'tennis forehand grip']);
    expect(a).not.toEqual(b);
  });
});

describe('createEmbeddingProvider', () => {
  it('defaults to the stub provider when no kind is given', () => {
    const p = createEmbeddingProvider();
    expect(p.name).toBe('stub');
    expect(p.dimension).toBeGreaterThan(0);
  });

  it('builds the requested provider', () => {
    expect(createEmbeddingProvider({ kind: 'stub' }).name).toBe('stub');
    expect(createEmbeddingProvider({ kind: 'ollama' }).name).toBe('ollama');
    expect(createEmbeddingProvider({ kind: 'onnx' }).name).toBe('onnx');
  });

  it('respects a supplied Config when constructing remote providers', () => {
    const provider = createEmbeddingProvider({
      kind: 'ollama',
      config: {
        embeddings: 'ollama',
        ollama: { url: 'http://example.local:11434', model: 'test-model' },
        onnx: { model: 'Xenova/all-MiniLM-L6-v2' },
      },
    });
    expect(provider.name).toBe('ollama');
  });
});
