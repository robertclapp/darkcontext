import type { CompleteOptions, LLMProvider } from './provider.js';

/**
 * Deterministic, dependency-free LLM. Returns a synthetic "summary"
 * built from the prompt itself — the first sentence after the first
 * "INPUT:" marker, capped at `maxTokens` characters (treating chars as
 * a coarse proxy for tokens).
 *
 * Used as the default in dev/tests so the full summarize path can run
 * without Ollama installed. Production callers configure
 * `DARKCONTEXT_LLM=ollama` and a real generation model.
 */
export class StubLLMProvider implements LLMProvider {
  readonly name = 'stub';

  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
    const cap = opts.maxTokens ?? 200;
    const marker = 'INPUT:';
    const idx = prompt.lastIndexOf(marker);
    const body = idx >= 0 ? prompt.slice(idx + marker.length) : prompt;
    const firstSentence = body.trim().split(/(?<=[.!?])\s+/)[0] ?? body.trim();
    const truncated = firstSentence.length > cap ? `${firstSentence.slice(0, cap - 1)}…` : firstSentence;
    return `summary: ${truncated}`;
  }
}
