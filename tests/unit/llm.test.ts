import { describe, it, expect } from 'vitest';

import { StubLLMProvider, OllamaLLMProvider, createLLMProvider, LLMError } from '../../src/core/llm/index.js';

describe('LLM providers', () => {
  describe('StubLLMProvider', () => {
    it('returns a deterministic summary derived from the INPUT marker', async () => {
      const llm = new StubLLMProvider();
      const out = await llm.complete(
        ['Some instruction header.', 'INPUT:', 'A short story. With multiple sentences.'].join('\n')
      );
      expect(out).toBe('summary: A short story.');
    });

    it('respects maxTokens (used as a coarse char cap)', async () => {
      const llm = new StubLLMProvider();
      const long = 'x'.repeat(500);
      const out = await llm.complete(`INPUT:\n${long}`, { maxTokens: 50 });
      // 'summary: ' (9) + capped body + ellipsis
      expect(out.length).toBeLessThanOrEqual('summary: '.length + 50);
      expect(out.endsWith('…')).toBe(true);
    });

    it('falls back to the whole prompt when no INPUT marker is present', async () => {
      const llm = new StubLLMProvider();
      const out = await llm.complete('No marker. Just text.');
      expect(out).toBe('summary: No marker.');
    });
  });

  describe('createLLMProvider factory', () => {
    it('defaults to the stub when no kind/config is given', () => {
      const llm = createLLMProvider();
      expect(llm.name).toBe('stub');
    });

    it('returns an Ollama instance for kind=ollama', () => {
      const llm = createLLMProvider({
        kind: 'ollama',
        config: {
          llm: { kind: 'ollama', model: 'llama3.2' },
          ollama: { url: 'http://localhost:11434', model: 'nomic-embed-text' },
        },
      });
      expect(llm).toBeInstanceOf(OllamaLLMProvider);
      expect(llm.name).toBe('ollama');
    });
  });

  describe('OllamaLLMProvider', () => {
    it('wraps a network failure as LLMError with a useful message', async () => {
      // Bind to a port nothing is listening on.
      const llm = new OllamaLLMProvider({ url: 'http://127.0.0.1:1', model: 'llama3.2' });
      await expect(llm.complete('hi')).rejects.toBeInstanceOf(LLMError);
    });
  });
});
