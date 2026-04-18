import { EmbeddingError, type EmbeddingProvider } from './provider.js';

export interface OllamaOptions {
  url?: string;
  model?: string;
  /** Pre-known dimension; if omitted we probe once with a dummy embed. */
  dimension?: number;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama';
  private _dimension: number;
  private readonly url: string;
  private readonly model: string;

  constructor(opts: OllamaOptions = {}) {
    this.url = (opts.url ?? process.env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/$/, '');
    this.model = opts.model ?? process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';
    this._dimension = opts.dimension ?? 0;
  }

  get dimension(): number {
    return this._dimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const vecs: number[][] = [];
    for (const t of texts) {
      const v = await this.embedOne(t);
      vecs.push(v);
    }
    if (this._dimension === 0 && vecs[0]) this._dimension = vecs[0].length;
    return vecs;
  }

  private async embedOne(prompt: string): Promise<number[]> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt }),
      });
    } catch (err) {
      throw new EmbeddingError(`Ollama request failed (${this.url}): ${(err as Error).message}`, err);
    }
    if (!res.ok) {
      throw new EmbeddingError(`Ollama returned ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { embedding?: number[] };
    if (!body.embedding || !Array.isArray(body.embedding)) {
      throw new EmbeddingError('Ollama response missing `embedding` array');
    }
    return body.embedding;
  }
}
