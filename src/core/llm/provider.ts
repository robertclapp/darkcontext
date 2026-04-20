import { DarkContextError } from '../errors.js';

/**
 * Generative LLM provider — mirrors the shape of `EmbeddingProvider` but
 * for completion-style outputs. Used by `Summarize` (and any future
 * generative feature) so DarkContext stays provider-agnostic.
 *
 * The interface is intentionally minimal: a single `complete(prompt,
 * opts)` entrypoint. We do NOT model chat-message arrays here — every
 * caller in the project assembles its own prompt string, which keeps
 * provider implementations small and avoids a leaky abstraction over
 * subtly different role schemas (Ollama vs OpenAI vs Anthropic).
 */
export interface LLMProvider {
  /** Stable label, surfaced in `dcx doctor` and the audit trail. */
  readonly name: string;
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;
}

export interface CompleteOptions {
  /** Soft upper bound on output tokens. Providers may cap below this. */
  maxTokens?: number;
  /** 0..1, lower = more deterministic. Defaults to provider-specific. */
  temperature?: number;
}

/** A generative LLM provider failed — network, model load, or parse error. */
export class LLMError extends DarkContextError {}
