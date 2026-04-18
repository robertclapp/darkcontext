import { DarkContextError } from '../errors.js';

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimension: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** An embedding provider failed — network, model load, or shape mismatch. */
export class EmbeddingError extends DarkContextError {}
