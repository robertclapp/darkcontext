import type Database from 'better-sqlite3';

import type { DarkContextDb } from '../store/db.js';
import { ensureVecTables, setEmbedDim } from '../store/db.js';
import type { EmbeddingProvider } from '../embeddings/provider.js';

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
  constructor(
    private readonly db: DarkContextDb,
    private readonly embeddings: EmbeddingProvider
  ) {}

  async ingest(input: IngestInput, chunkOpts: ChunkOptions = {}): Promise<IngestResult> {
    const chunks = chunkText(input.content, chunkOpts);
    if (chunks.length === 0) throw new Error('document is empty after chunking');

    const scopeId = input.scope ? resolveScopeId(this.db.raw, input.scope) : defaultScopeId(this.db.raw);
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

    await this.writeVectors(chunkIds, chunks);

    return {
      document: this.getById(documentId),
      chunks: chunks.length,
    };
  }

  getById(id: number): Document {
    const row = this.db.raw
      .prepare(`${DOC_SELECT} WHERE d.id = ?`)
      .get(id) as DocRow | undefined;
    if (!row) throw new Error(`document ${id} not found`);
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
      if (this.db.hasVec && this.db.embedDim > 0) {
        const chunkIds = this.db.raw
          .prepare('SELECT id FROM document_chunks WHERE document_id = ?')
          .all(docId) as { id: number }[];
        const del = this.db.raw.prepare('DELETE FROM document_chunks_vec WHERE rowid = ?');
        for (const c of chunkIds) del.run(BigInt(c.id));
      }
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
    const params: unknown[] = [Buffer.from(new Float32Array(qv).buffer), limit];
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
      score: 0.5,
      match: 'keyword' as const,
    }));
  }

  private async writeVectors(chunkIds: number[], chunks: string[]): Promise<void> {
    if (!this.db.hasVec || chunks.length === 0) return;
    let vecs: number[][];
    try {
      vecs = await this.embeddings.embed(chunks);
    } catch {
      return;
    }
    if (vecs.length === 0) return;

    const dim = vecs[0]!.length;
    if (this.db.embedDim === 0) {
      setEmbedDim(this.db.raw, dim);
      (this.db as { embedDim: number }).embedDim = dim;
      ensureVecTables(this.db.raw, dim);
    } else if (dim !== this.db.embedDim) {
      throw new Error(
        `Embedding dim mismatch: provider returned ${dim}, store is ${this.db.embedDim}.`
      );
    }

    const insert = this.db.raw.prepare(
      'INSERT INTO document_chunks_vec (rowid, embedding) VALUES (?, ?)'
    );
    const tx = this.db.raw.transaction(() => {
      for (let i = 0; i < chunkIds.length; i++) {
        insert.run(BigInt(chunkIds[i]!), Buffer.from(new Float32Array(vecs[i]!).buffer));
      }
    });
    tx();
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

function resolveScopeId(db: Database.Database, name: string): number {
  const row = db.prepare('SELECT id FROM scopes WHERE name = ?').get(name) as
    | { id: number }
    | undefined;
  if (row) return row.id;
  const info = db.prepare('INSERT INTO scopes (name) VALUES (?)').run(name);
  return Number(info.lastInsertRowid);
}

function defaultScopeId(db: Database.Database): number {
  const row = db.prepare("SELECT id FROM scopes WHERE name = 'default'").get() as
    | { id: number }
    | undefined;
  if (!row) throw new Error('default scope missing — did you run migrations?');
  return row.id;
}
