import { describe, it, expect } from 'vitest';

import { StubEmbeddingProvider } from '../../src/core/embeddings/stub.js';
import { resolveProviderKind, createEmbeddingProvider } from '../../src/core/embeddings/index.js';

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

describe('resolveProviderKind', () => {
  it('defaults to stub', () => {
    expect(resolveProviderKind()).toBe('stub');
  });

  it('accepts explicit kinds', () => {
    expect(resolveProviderKind('ollama')).toBe('ollama');
    expect(resolveProviderKind('onnx')).toBe('onnx');
  });

  it('rejects unknown kinds', () => {
    expect(() => resolveProviderKind('gemini')).toThrow();
  });
});

describe('createEmbeddingProvider', () => {
  it('returns a stub provider by default', () => {
    const p = createEmbeddingProvider('stub');
    expect(p.name).toBe('stub');
    expect(p.dimension).toBeGreaterThan(0);
  });
});
