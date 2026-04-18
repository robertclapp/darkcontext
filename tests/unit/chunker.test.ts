import { describe, it, expect } from 'vitest';

import { chunkText } from '../../src/core/documents/chunker.js';

describe('chunkText', () => {
  it('returns an empty array for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n  ')).toEqual([]);
  });

  it('keeps short text as a single chunk', () => {
    const text = 'The quick brown fox.';
    expect(chunkText(text, { size: 1000 })).toEqual([text]);
  });

  it('splits long text into overlapping chunks', () => {
    const para = 'Sentence one. Sentence two. Sentence three. Sentence four. ';
    const text = para.repeat(30);
    const chunks = chunkText(text, { size: 200, overlap: 40 });
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk should be <= size-ish; allow minor slack from boundary search.
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(220);
    // Adjacent chunks should share some characters (overlap).
    for (let i = 1; i < chunks.length; i++) {
      const tail = chunks[i - 1]!.slice(-30);
      expect(chunks[i]!.startsWith(tail) || chunks[i]!.includes(tail.slice(0, 10))).toBe(true);
    }
  });

  it('prefers paragraph boundaries when available', () => {
    const block = 'Alpha paragraph line one. Alpha paragraph line two.\n\nBeta paragraph line one. Beta paragraph line two.\n\nGamma paragraph line one. Gamma paragraph line two.\n\n';
    const chunks = chunkText(block, { size: 120, overlap: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    // At least one chunk boundary should be on a paragraph break (chunk ends w/ period then newline splits).
    expect(chunks[0]!.endsWith('two.') || chunks[0]!.endsWith('one.')).toBe(true);
  });

  it('rejects invalid configuration', () => {
    expect(() => chunkText('x', { size: 0 })).toThrow();
    expect(() => chunkText('x', { size: 100, overlap: 100 })).toThrow();
  });
});
