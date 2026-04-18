import { EmbeddingError, type EmbeddingProvider } from './provider.js';

export interface OllamaOptions {
  /** Ollama server URL (trailing slash will be stripped). */
  url: string;
  /** Embedding model name. */
  model: string;
  /** Pre-known dimension; if omitted we learn it from the first embed. */
  dimension?: number;
}

/**
 * Ollama embeddings client. Uses the modern `/api/embed` endpoint which
 * accepts a batched `input: string[]` and returns `embeddings: number[][]`
 * in a single HTTP round-trip. This is a significant improvement over the
 * older `/api/embeddings` endpoint that only accepts one prompt per call
 * (the naive loop could add tens of seconds to a single document ingest).
 *
 * If the server returns a "model does not support batching" style error
 * we fall back to per-prompt calls transparently — older Ollama versions
 * or custom models may require it. The fallback is only engaged once per
 * process; it's cached in `batchSupported`.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  private _dimension: number;
  private readonly url: string;
  private readonly model: string;
  private batchSupported: boolean | undefined;

  constructor(opts: OllamaOptions) {
    this.url = opts.url.replace(/\/$/, '');
    this.model = opts.model;
    this._dimension = opts.dimension ?? 0;
  }

  get dimension(): number {
    return this._dimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    if (this.batchSupported !== false) {
      try {
        const out = await this.embedBatch(texts);
        this.batchSupported = true;
        if (this._dimension === 0 && out[0]) this._dimension = out[0].length;
        return out;
      } catch (err) {
        // One-time probe: if the batch endpoint isn't available, fall through
        // and never try it again for this provider instance.
        if (this.batchSupported === undefined) {
          this.batchSupported = false;
        } else {
          throw err;
        }
      }
    }

    const vecs: number[][] = [];
    for (const t of texts) vecs.push(await this.embedOne(t));
    if (this._dimension === 0 && vecs[0]) this._dimension = vecs[0].length;
    return vecs;
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await this.postJson('/api/embed', { model: this.model, input: texts });
    const body = (await res.json()) as { embeddings?: number[][] };
    if (!Array.isArray(body.embeddings) || body.embeddings.length !== texts.length) {
      throw new EmbeddingError(
        `Ollama /api/embed returned ${body.embeddings?.length ?? 0} vectors for ${texts.length} inputs`
      );
    }
    return body.embeddings;
  }

  private async embedOne(prompt: string): Promise<number[]> {
    const res = await this.postJson('/api/embeddings', { model: this.model, prompt });
    const body = (await res.json()) as { embedding?: number[] };
    if (!body.embedding || !Array.isArray(body.embedding)) {
      throw new EmbeddingError('Ollama response missing `embedding` array');
    }
    return body.embedding;
  }

  private async postJson(path: string, payload: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.url}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new EmbeddingError(`Ollama request failed (${this.url}${path}): ${(err as Error).message}`, err);
    }
    if (!res.ok) {
      throw new EmbeddingError(`Ollama ${path} returned ${res.status}: ${await res.text()}`);
    }
    return res;
  }
}
