import type { Config } from '../config.js';

import { OllamaLLMProvider } from './ollama.js';
import type { LLMProvider } from './provider.js';
import { StubLLMProvider } from './stub.js';

export type LLMProviderKind = 'stub' | 'ollama';

export interface LLMFactoryOptions {
  kind?: LLMProviderKind;
  /** Resolved config; when omitted only `stub` is safe to construct. */
  config?: Pick<Config, 'llm' | 'ollama'>;
}

/**
 * Build an LLM provider. The factory mirrors `createEmbeddingProvider`:
 * `kind` overrides config; config falls back to defaults; defaults yield
 * the stub so tests/dev work without a running Ollama.
 */
export function createLLMProvider(opts: LLMFactoryOptions = {}): LLMProvider {
  const kind = opts.kind ?? opts.config?.llm?.kind ?? 'stub';
  switch (kind) {
    case 'stub':
      return new StubLLMProvider();
    case 'ollama':
      return new OllamaLLMProvider({
        url: opts.config?.ollama?.url ?? 'http://localhost:11434',
        model: opts.config?.llm?.model ?? 'llama3.2',
      });
  }
}

export { LLMError } from './provider.js';
export type { LLMProvider, CompleteOptions } from './provider.js';
export { StubLLMProvider } from './stub.js';
export { OllamaLLMProvider } from './ollama.js';
