import { LLMError, type CompleteOptions, type LLMProvider } from './provider.js';

/** Default upper bound on a single generate call. 5 minutes is generous
 *  enough for slow CPU-only inference but bounds the worst case so a
 *  silently-hung Ollama can't pin a CLI/MCP request forever. */
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export interface OllamaLLMOptions {
  /** Ollama server URL (trailing slash will be stripped). */
  url: string;
  /** Generation model name. */
  model: string;
  /**
   * Per-request timeout in milliseconds. Defaults to 5 minutes — long
   * enough for slow CPU inference, short enough that a wedged process
   * eventually surfaces an error instead of hanging. Pass 0 to disable.
   */
  timeoutMs?: number;
}

/**
 * Ollama generation client. Hits `/api/generate` with `stream: false` so
 * we always get a single JSON response — DarkContext's summarize call
 * doesn't need streaming, and a non-streamed call is one fewer parser to
 * own. An AbortController-based timeout (5 min default) bounds the call;
 * operators can override via the constructor when running giant models
 * on slow CPUs.
 */
export class OllamaLLMProvider implements LLMProvider {
  readonly name = 'ollama';
  private readonly url: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(opts: OllamaLLMOptions) {
    this.url = opts.url.replace(/\/$/, '');
    this.model = opts.model;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
    // Ollama's `options` mirror llama.cpp sampler params. We forward the
    // two we expose; everything else uses the model's defaults.
    const ollamaOpts: Record<string, number> = {};
    if (opts.maxTokens !== undefined) ollamaOpts.num_predict = opts.maxTokens;
    if (opts.temperature !== undefined) ollamaOpts.temperature = opts.temperature;

    // AbortController guarantees the fetch resolves within timeoutMs even
    // when the server hangs without sending a byte. `timeoutMs === 0`
    // disables the bound — used by callers that genuinely want unbounded.
    const controller = new AbortController();
    const timer =
      this.timeoutMs > 0
        ? setTimeout(() => controller.abort(new Error(`timed out after ${this.timeoutMs}ms`)), this.timeoutMs)
        : null;
    let res: Response;
    try {
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
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') {
          throw new LLMError(
            `Ollama generate timed out after ${this.timeoutMs}ms (${this.url}/api/generate)`,
            err
          );
        }
        throw new LLMError(`Ollama generate failed (${this.url}/api/generate): ${(err as Error).message}`, err);
      }
      if (!res.ok) {
        throw new LLMError(`Ollama /api/generate returned ${res.status}: ${await res.text()}`);
      }
      // A 200 with a non-JSON body (reverse-proxy error page, truncated
      // stream) makes res.json() throw a raw SyntaxError. Map it to LLMError
      // so callers — and the provider-agnostic error contract — see a
      // consistent type instead of an opaque parse failure.
      let body: { response?: string };
      try {
        body = (await res.json()) as { response?: string };
      } catch (err) {
        throw new LLMError(
          `Ollama /api/generate returned a non-JSON body: ${(err as Error).message}`,
          err
        );
      }
      if (typeof body.response !== 'string') {
        throw new LLMError('Ollama /api/generate response missing `response` string field');
      }
      return body.response.trim();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
