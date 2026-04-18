import type { DarkContextDb } from '../store/db.js';
import { VectorIndex } from '../store/vectorIndex.js';
import { resolveScopeOrDefault } from '../store/scopeHelpers.js';
import type { EmbeddingProvider } from '../embeddings/provider.js';

import type { Memory, NewMemory, RecallHit, RecallOptions } from './types.js';

interface MemoryRow {
  id: number;
  content: string;
  kind: string;
  tags_json: string;
  scope_name: string | null;
  source: string | null;
  created_at: number;
  updated_at: number;
}

const BASE_SELECT = `
  SELECT m.id, m.content, m.kind, m.tags_json, s.name AS scope_name,
         m.source, m.created_at, m.updated_at
  FROM memories m
  LEFT JOIN scopes s ON s.id = m.scope_id
`;

export class Memories {
  private readonly vectors: VectorIndex;

  constructor(
    private readonly db: DarkContextDb,
    private readonly embeddings: EmbeddingProvider
  ) {
    this.vectors = new VectorIndex(db, embeddings, 'memories_vec');
  }

  async remember(input: NewMemory): Promise<Memory> {
    const now = Date.now();
    const scopeId = resolveScopeOrDefault(this.db.raw, input.scope);
    const tagsJson = JSON.stringify(input.tags ?? []);

    const info = this.db.raw
      .prepare(
        `INSERT INTO memories (content, kind, tags_json, scope_id, source, created_at, updated_at)
         VALUES (@content, @kind, @tags_json, @scope_id, @source, @now, @now)`
      )
      .run({
        content: input.content,
        kind: input.kind ?? 'fact',
        tags_json: tagsJson,
        scope_id: scopeId,
        source: input.source ?? null,
        now,
      });
    const id = Number(info.lastInsertRowid);
    await this.vectors.write([id], [input.content]);
    return this.getById(id);
  }

  getById(id: number): Memory {
    const row = this.db.raw
      .prepare(`${BASE_SELECT} WHERE m.id = ?`)
      .get(id) as MemoryRow | undefined;
    if (!row) throw new Error(`Memory ${id} not found`);
    return rowToMemory(row);
  }

  list(opts: { scope?: string; limit?: number } = {}): Memory[] {
    const limit = opts.limit ?? 100;
    const rows = opts.scope
      ? (this.db.raw
          .prepare(`${BASE_SELECT} WHERE s.name = ? ORDER BY m.created_at DESC LIMIT ?`)
          .all(opts.scope, limit) as MemoryRow[])
      : (this.db.raw
          .prepare(`${BASE_SELECT} ORDER BY m.created_at DESC LIMIT ?`)
          .all(limit) as MemoryRow[]);
    return rows.map(rowToMemory);
  }

  forget(id: number): boolean {
    const tx = this.db.raw.transaction((memId: number) => {
      this.vectors.deleteOne(memId);
      const res = this.db.raw.prepare('DELETE FROM memories WHERE id = ?').run(memId);
      return res.changes > 0;
    });
    return tx(id) as boolean;
  }

  async recall(query: string, opts: RecallOptions = {}): Promise<RecallHit[]> {
    const limit = opts.limit ?? 10;
    if (this.db.hasVec && this.db.embedDim > 0) {
      const [qv] = await this.embeddings.embed([query]);
      if (qv) return this.vectorRecall(qv, limit, opts.scope);
    }
    return this.keywordRecall(query, limit, opts.scope);
  }

  /**
   * Re-embed every memory and rewrite `memories_vec`. Used by `dcx reindex`
   * after swapping embedding providers or recovering from a failed write.
   */
  async reindex(): Promise<number> {
    this.vectors.truncate();
    const rows = this.db.raw
      .prepare('SELECT id, content FROM memories ORDER BY id')
      .all() as Array<{ id: number; content: string }>;
    if (rows.length === 0) return 0;
    await this.vectors.write(
      rows.map((r) => r.id),
      rows.map((r) => r.content)
    );
    return rows.length;
  }

  private vectorRecall(qv: number[], limit: number, scope?: string): RecallHit[] {
    const sql = `
      SELECT m.id AS id, m.content, m.kind, m.tags_json, s.name AS scope_name,
             m.source, m.created_at, m.updated_at, v.distance AS distance
      FROM memories_vec v
      JOIN memories m ON m.id = v.rowid
      LEFT JOIN scopes s ON s.id = m.scope_id
      WHERE v.embedding MATCH ?
        AND k = ?
        ${scope ? 'AND s.name = ?' : ''}
      ORDER BY v.distance
    `;
    const params: unknown[] = [VectorIndex.queryBlob(qv), limit];
    if (scope) params.push(scope);
    const rows = this.db.raw.prepare(sql).all(...params) as (MemoryRow & { distance: number })[];
    return rows.map((r) => ({
      memory: rowToMemory(r),
      score: 1 / (1 + r.distance),
      match: 'vector' as const,
    }));
  }

  private keywordRecall(query: string, limit: number, scope?: string): RecallHit[] {
    const like = `%${query.toLowerCase()}%`;
    const sql = `
      ${BASE_SELECT}
      WHERE LOWER(m.content) LIKE ?
        ${scope ? 'AND s.name = ?' : ''}
      ORDER BY m.created_at DESC
      LIMIT ?
    `;
    const params: unknown[] = [like];
    if (scope) params.push(scope);
    params.push(limit);
    const rows = this.db.raw.prepare(sql).all(...params) as MemoryRow[];
    return rows.map((r) => ({
      memory: rowToMemory(r),
      score: 0.5,
      match: 'keyword' as const,
    }));
  }
}

function rowToMemory(row: MemoryRow): Memory {
  let tags: string[] = [];
  try {
    const parsed = JSON.parse(row.tags_json);
    if (Array.isArray(parsed)) tags = parsed.map(String);
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    content: row.content,
    kind: row.kind,
    tags,
    scope: row.scope_name,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
