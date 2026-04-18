import { DarkContextError } from '../errors.js';

export interface EmbeddingProvider {
  /** Stable label, surfaced in `dcx doctor` and the audit trail. */
  readonly name: string;
  /**
   * Observed vector dimension.
   *
   * `0` means "not yet known" for providers that learn it from the first
   * response (Ollama, ONNX). Becomes stable and non-zero after the first
   * successful `embed()` call and must not change thereafter — the store
   * pins `embed_dim` in `meta` and `VectorIndex` throws `ConfigError` on
   * mismatch. Consumers that depend on `dimension` being non-zero should
   * call `embed()` first (or read the stored value from `DarkContextDb
   * .embedDim` after at least one write).
   */
  readonly dimension: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** An embedding provider failed — network, model load, or shape mismatch. */
export class EmbeddingError extends DarkContextError {}
