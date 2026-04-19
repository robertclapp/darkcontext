import { LLMError, type CompleteOptions, type LLMProvider } from './provider.js';

export interface OllamaLLMOptions {
  /** Ollama server URL (trailing slash will be stripped). */
  url: string;
  /** Generation model name. */
  model: string;
}

/**
 * Ollama generation client. Hits `/api/generate` with `stream: false` so
 * we always get a single JSON response — DarkContext's summarize call
 * doesn't need streaming, and a non-streamed call is one fewer parser to
 * own. Caller-side timeouts are intentionally absent: the LLM may take
 * 30s+ for a long summary on a CPU-bound machine, and a hard timeout
 * would make that path silently fail. Operators can layer timeouts at
 * the transport (HTTP client) or shell level.
 */
export class OllamaLLMProvider implements LLMProvider {
  readonly name = 'ollama';
  private readonly url: string;
  private readonly model: string;

  constructor(opts: OllamaLLMOptions) {
    this.url = opts.url.replace(/\/$/, '');
    this.model = opts.model;
  }

  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
    // Ollama's `options` mirror llama.cpp sampler params. We forward the
    // two we expose; everything else uses the model's defaults.
    const ollamaOpts: Record<string, number> = {};
    if (opts.maxTokens !== undefined) ollamaOpts.num_predict = opts.maxTokens;
    if (opts.temperature !== undefined) ollamaOpts.temperature = opts.temperature;

    let res: Response;
    try {
      res = await fetch(`${this.url}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          ...(Object.keys(ollamaOpts).length > 0 ? { options: ollamaOpts } : {}),
        }),
      });
    } catch (err) {
      throw new LLMError(`Ollama generate failed (${this.url}/api/generate): ${(err as Error).message}`, err);
    }
    if (!res.ok) {
      throw new LLMError(`Ollama /api/generate returned ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { response?: string };
    if (typeof body.response !== 'string') {
      throw new LLMError('Ollama /api/generate response missing `response` string field');
    }
    return body.response.trim();
  }
}
