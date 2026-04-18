import type { DarkContextDb } from '../store/db.js';
import { VectorIndex } from '../store/vectorIndex.js';
import { resolveScopeOrDefault } from '../store/scopeHelpers.js';
import { buildFtsQuery, isFtsAvailable } from '../store/fts.js';
import type { EmbeddingProvider } from '../embeddings/provider.js';
import { NotFoundError, ValidationError } from '../errors.js';

import { chunkText, type ChunkOptions } from './chunker.js';
import type {
  Document,
  DocumentChunkHit,
  IngestInput,
  IngestResult,
  SearchOptions,
} from './types.js';

interface DocRow {
  id: number;
  title: string;
  source_uri: string | null;
  mime: string;
  scope_name: string | null;
  ingested_at: number;
}

interface ChunkHitRow extends DocRow {
  chunk_id: number;
  chunk_idx: number;
  content: string;
  distance?: number;
}

const DOC_SELECT = `
  SELECT d.id, d.title, d.source_uri, d.mime, s.name AS scope_name, d.ingested_at
  FROM documents d
  LEFT JOIN scopes s ON s.id = d.scope_id
`;

export class Documents {
  private readonly vectors: VectorIndex;

  constructor(
    private readonly db: DarkContextDb,
    private readonly embeddings: EmbeddingProvider
  ) {
    this.vectors = new VectorIndex(db, embeddings, 'document_chunks_vec');
  }

  async ingest(input: IngestInput, chunkOpts: ChunkOptions = {}): Promise<IngestResult> {
    if (!input.title.trim()) throw new ValidationError('title', 'must not be empty');
    const chunks = chunkText(input.content, chunkOpts);
    if (chunks.length === 0) throw new ValidationError('content', 'document is empty after chunking');

    const scopeId = resolveScopeOrDefault(this.db.raw, input.scope);
    const now = Date.now();

    const info = this.db.raw
      .prepare(
        `INSERT INTO documents (title, source_uri, mime, scope_id, ingested_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.title, input.sourceUri ?? null, input.mime ?? 'text/plain', scopeId, now);
    const documentId = Number(info.lastInsertRowid);

    const insertChunk = this.db.raw.prepare(
      `INSERT INTO document_chunks (document_id, chunk_idx, content) VALUES (?, ?, ?)`
    );
    const chunkIds: number[] = [];
    const insertChunks = this.db.raw.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const r = insertChunk.run(documentId, i, chunks[i]!);
        chunkIds.push(Number(r.lastInsertRowid));
      }
    });
    insertChunks();

    await this.vectors.write(chunkIds, chunks);

    return { document: this.getById(documentId), chunks: chunks.length };
  }

  getById(id: number): Document {
    const row = this.db.raw
      .prepare(`${DOC_SELECT} WHERE d.id = ?`)
      .get(id) as DocRow | undefined;
    if (!row) throw new NotFoundError('document', id);
    return rowToDoc(row);
  }

  list(opts: { scope?: string; limit?: number } = {}): Document[] {
    const limit = opts.limit ?? 100;
    const rows = opts.scope
      ? (this.db.raw
          .prepare(`${DOC_SELECT} WHERE s.name = ? ORDER BY d.ingested_at DESC LIMIT ?`)
          .all(opts.scope, limit) as DocRow[])
      : (this.db.raw
          .prepare(`${DOC_SELECT} ORDER BY d.ingested_at DESC LIMIT ?`)
          .all(limit) as DocRow[]);
    return rows.map(rowToDoc);
  }

  delete(id: number): boolean {
    const tx = this.db.raw.transaction((docId: number) => {
      const chunkIds = (this.db.raw
        .prepare('SELECT id FROM document_chunks WHERE document_id = ?')
        .all(docId) as { id: number }[]).map((r) => r.id);
      this.vectors.deleteMany(chunkIds);
      const res = this.db.raw.prepare('DELETE FROM documents WHERE id = ?').run(docId);
      return res.changes > 0;
    });
    return tx(id) as boolean;
  }

  async search(query: string, opts: SearchOptions = {}): Promise<DocumentChunkHit[]> {
    const limit = opts.limit ?? 10;
    if (this.db.hasVec && this.db.embedDim > 0) {
      const [qv] = await this.embeddings.embed([query]);
      if (qv) return this.vectorSearch(qv, limit, opts.scope);
    }
    return this.keywordSearch(query, limit, opts.scope);
  }

  /** Re-embed all chunks; used by `dcx reindex`. Returns the chunk count written. */
  async reindex(): Promise<number> {
    const rows = this.db.raw
      .prepare('SELECT id, content FROM document_chunks ORDER BY id')
      .all() as Array<{ id: number; content: string }>;
    await this.vectors.reindex(
      rows.map((r) => r.id),
      rows.map((r) => r.content)
    );
    return rows.length;
  }

  private vectorSearch(qv: number[], limit: number, scope?: string): DocumentChunkHit[] {
    const sql = `
      SELECT d.id AS id, d.title, d.source_uri, d.mime, s.name AS scope_name,
             d.ingested_at, c.id AS chunk_id, c.chunk_idx, c.content,
             v.distance AS distance
      FROM document_chunks_vec v
      JOIN document_chunks c ON c.id = v.rowid
      JOIN documents d ON d.id = c.document_id
      LEFT JOIN scopes s ON s.id = d.scope_id
      WHERE v.embedding MATCH ?
        AND k = ?
        ${scope ? 'AND s.name = ?' : ''}
      ORDER BY v.distance
    `;
    const params: unknown[] = [VectorIndex.queryBlob(qv), limit];
    if (scope) params.push(scope);
    const rows = this.db.raw.prepare(sql).all(...params) as ChunkHitRow[];
    return rows.map((r) => ({
      documentId: r.id,
      title: r.title,
      scope: r.scope_name,
      chunkIdx: r.chunk_idx,
      content: r.content,
      score: r.distance !== undefined ? 1 / (1 + r.distance) : 0,
      match: 'vector' as const,
    }));
  }

  private keywordSearch(query: string, limit: number, scope?: string): DocumentChunkHit[] {
    const ftsQuery = buildFtsQuery(query);
    if (isFtsAvailable(this.db.raw) && ftsQuery.length > 0) {
      return this.ftsSearch(ftsQuery, limit, scope);
    }
    return this.likeSearch(query, limit, scope);
  }

  private ftsSearch(ftsQuery: string, limit: number, scope?: string): DocumentChunkHit[] {
    const sql = `
      SELECT d.id AS id, d.title, d.source_uri, d.mime, s.name AS scope_name,
             d.ingested_at, c.id AS chunk_id, c.chunk_idx, c.content, f.rank AS rank
      FROM document_chunks_fts f
      JOIN document_chunks c ON c.id = f.rowid
      JOIN documents d ON d.id = c.document_id
      LEFT JOIN scopes s ON s.id = d.scope_id
      WHERE document_chunks_fts MATCH ?
        ${scope ? 'AND s.name = ?' : ''}
      ORDER BY f.rank
      LIMIT ?
    `;
    const params: unknown[] = [ftsQuery];
    if (scope) params.push(scope);
    params.push(limit);
    const rows = this.db.raw.prepare(sql).all(...params) as (ChunkHitRow & { rank: number })[];
    return rows.map((r) => ({
      documentId: r.id,
      title: r.title,
      scope: r.scope_name,
      chunkIdx: r.chunk_idx,
      content: r.content,
      score: Math.min(1, 1 / (1 + Math.abs(r.rank))),
      match: 'keyword' as const,
    }));
  }

  private likeSearch(query: string, limit: number, scope?: string): DocumentChunkHit[] {
    const like = `%${query.toLowerCase()}%`;
    const sql = `
      SELECT d.id AS id, d.title, d.source_uri, d.mime, s.name AS scope_name,
             d.ingested_at, c.id AS chunk_id, c.chunk_idx, c.content
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      LEFT JOIN scopes s ON s.id = d.scope_id
      WHERE LOWER(c.content) LIKE ?
        ${scope ? 'AND s.name = ?' : ''}
      ORDER BY d.ingested_at DESC, c.chunk_idx
      LIMIT ?
    `;
    const params: unknown[] = [like];
    if (scope) params.push(scope);
    params.push(limit);
    const rows = this.db.raw.prepare(sql).all(...params) as ChunkHitRow[];
    return rows.map((r) => ({
      documentId: r.id,
      title: r.title,
      scope: r.scope_name,
      chunkIdx: r.chunk_idx,
      content: r.content,
      score: 0.3,
      match: 'keyword' as const,
    }));
  }
}

function rowToDoc(row: DocRow): Document {
  return {
    id: row.id,
    title: row.title,
    sourceUri: row.source_uri,
    mime: row.mime,
    scope: row.scope_name,
    ingestedAt: row.ingested_at,
  };
}
