import { EmbeddingError, type EmbeddingProvider } from './provider.js';

export interface OnnxOptions {
  model: string;
}

/**
 * Local ONNX embeddings via `@xenova/transformers`. Not a hard dependency —
 * loaded dynamically so users who rely on Ollama or the stub don't pull in
 * ~100MB of model runtime. Install on demand: `npm i @xenova/transformers`.
 */
export class OnnxEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'onnx';
  private _dimension = 0;
  private readonly modelId: string;
  private pipelinePromise: Promise<unknown> | null = null;

  constructor(opts: OnnxOptions) {
    this.modelId = opts.model;
  }

  get dimension(): number {
    return this._dimension;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const extractor = (await this.getPipeline()) as (
      t: string | string[],
      opts: { pooling: 'mean'; normalize: boolean }
    ) => Promise<{ data: Float32Array; dims: number[] }>;

    const out: number[][] = [];
    for (const t of texts) {
      const r = await extractor(t, { pooling: 'mean', normalize: true });
      const v = Array.from(r.data);
      if (this._dimension === 0) this._dimension = v.length;
      out.push(v);
    }
    return out;
  }

  private async getPipeline(): Promise<unknown> {
    if (this.pipelinePromise) return this.pipelinePromise;
    // Cache the in-flight promise so concurrent embed() calls share one
    // init, but on failure clear the cache so a subsequent embed() can
    // retry (e.g. after the user installs @xenova/transformers).
    this.pipelinePromise = (async () => {
      let mod: { pipeline: (task: string, model: string) => Promise<unknown> };
      try {
        mod = (await import(
          /* @vite-ignore */ '@xenova/transformers' as string
        )) as typeof mod;
      } catch (err) {
        throw new EmbeddingError(
          '@xenova/transformers is not installed. Run `npm i @xenova/transformers` to use the ONNX provider.',
          err
        );
      }
      return mod.pipeline('feature-extraction', this.modelId);
    })().catch((err) => {
      this.pipelinePromise = null;
      throw err;
    });
    return this.pipelinePromise;
  }
}
