import type { DarkContextDb } from './db.js';
import { ensureVecTables, setEmbedDim } from './db.js';
import type { EmbeddingProvider } from '../embeddings/provider.js';

/**
 * Thin wrapper around a single sqlite-vec virtual table.
 *
 * Encapsulates three invariants that were previously duplicated across
 * Memories / Documents / Conversations:
 *
 *  1. `rowid` must be bound as BigInt. better-sqlite3 binds JS `Number` as
 *     SQLite FLOAT; sqlite-vec rejects that with "only integers allowed".
 *  2. The first successful write pins `embedDim` in the `meta` table;
 *     subsequent writes with a different dim throw rather than corrupt
 *     the index.
 *  3. Vector writes are best-effort with respect to the caller's
 *     transaction — if the embedding provider fails, the content row
 *     survives but will be missing from vector search until `dcx reindex`.
 */
export class VectorIndex {
  constructor(
    private readonly db: DarkContextDb,
    private readonly embeddings: EmbeddingProvider,
    /** sqlite-vec virtual table name (e.g. 'memories_vec'). */
    private readonly tableName: string
  ) {}

  /**
   * Embed `texts` and write them under `ids`. No-op if sqlite-vec is not
   * loaded. Swallows embedding errors so the caller's content-row insert
   * is not rolled back; callers can surface missing vectors via a health
   * check or by running `dcx reindex`.
   */
  async write(ids: number[], texts: string[]): Promise<void> {
    if (!this.db.hasVec || ids.length === 0) return;
    if (ids.length !== texts.length) {
      throw new Error(`VectorIndex.write: ids/texts length mismatch (${ids.length} vs ${texts.length})`);
    }

    let vecs: number[][];
    try {
      vecs = await this.embeddings.embed(texts);
    } catch {
      return;
    }
    if (vecs.length === 0) return;

    const dim = vecs[0]!.length;
    if (this.db.embedDim === 0) {
      setEmbedDim(this.db.raw, dim);
      this.db.embedDim = dim;
      ensureVecTables(this.db.raw, dim);
    } else if (dim !== this.db.embedDim) {
      throw new Error(
        `Embedding dim mismatch on ${this.tableName}: provider returned ${dim}, store is ${this.db.embedDim}. ` +
          `Re-initialize the store or run \`dcx reindex\`.`
      );
    }

    const insert = this.db.raw.prepare(
      `INSERT INTO ${this.tableName} (rowid, embedding) VALUES (?, ?)`
    );
    const tx = this.db.raw.transaction(() => {
      for (let i = 0; i < ids.length; i++) {
        insert.run(BigInt(ids[i]!), Buffer.from(new Float32Array(vecs[i]!).buffer));
      }
    });
    tx();
  }

  /** Remove a single row from the index (no-op when vec isn't loaded). */
  deleteOne(id: number): void {
    if (!this.db.hasVec || this.db.embedDim === 0) return;
    this.db.raw.prepare(`DELETE FROM ${this.tableName} WHERE rowid = ?`).run(BigInt(id));
  }

  /** Remove many rows. Runs in a transaction. */
  deleteMany(ids: number[]): void {
    if (!this.db.hasVec || this.db.embedDim === 0 || ids.length === 0) return;
    const del = this.db.raw.prepare(`DELETE FROM ${this.tableName} WHERE rowid = ?`);
    const tx = this.db.raw.transaction(() => {
      for (const id of ids) del.run(BigInt(id));
    });
    tx();
  }

  /** Drop all rows from this vector table (used by `dcx reindex`). */
  truncate(): void {
    if (!this.db.hasVec || this.db.embedDim === 0) return;
    this.db.raw.exec(`DELETE FROM ${this.tableName}`);
  }

  /**
   * Serialize a query vector to the blob shape sqlite-vec expects in a
   * `MATCH` predicate.
   */
  static queryBlob(vec: number[]): Buffer {
    return Buffer.from(new Float32Array(vec).buffer);
  }
}
