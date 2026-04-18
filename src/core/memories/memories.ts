import type Database from 'better-sqlite3';

import type { DarkContextDb } from '../store/db.js';
import { ensureVecTables, setEmbedDim } from '../store/db.js';
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

export class Memories {
  constructor(
    private readonly db: DarkContextDb,
    private readonly embeddings: EmbeddingProvider
  ) {}

  async remember(input: NewMemory): Promise<Memory> {
    const now = Date.now();
    const scopeId = input.scope ? resolveScopeId(this.db.raw, input.scope) : defaultScopeId(this.db.raw);
    const tagsJson = JSON.stringify(input.tags ?? []);

    const stmt = this.db.raw.prepare(
      `INSERT INTO memories (content, kind, tags_json, scope_id, source, created_at, updated_at)
       VALUES (@content, @kind, @tags_json, @scope_id, @source, @now, @now)`
    );
    const info = stmt.run({
      content: input.content,
      kind: input.kind ?? 'fact',
      tags_json: tagsJson,
      scope_id: scopeId,
      source: input.source ?? null,
      now,
    });
    const id = Number(info.lastInsertRowid);

    await this.writeVector(id, input.content);
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
      if (this.db.hasVec && this.db.embedDim > 0) {
        // sqlite-vec requires SQLITE_INTEGER for rowid; better-sqlite3 only
        // binds JS Numbers as FLOAT, so pass BigInt.
        this.db.raw.prepare('DELETE FROM memories_vec WHERE rowid = ?').run(BigInt(memId));
      }
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
    const params: unknown[] = [Buffer.from(new Float32Array(qv).buffer), limit];
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

  private async writeVector(memoryId: number, text: string): Promise<void> {
    if (!this.db.hasVec) return;
    let vec: number[];
    try {
      [vec] = (await this.embeddings.embed([text])) as [number[]];
    } catch {
      return;
    }
    if (!vec) return;

    if (this.db.embedDim === 0) {
      setEmbedDim(this.db.raw, vec.length);
      (this.db as { embedDim: number }).embedDim = vec.length;
      ensureVecTables(this.db.raw, vec.length);
    } else if (vec.length !== this.db.embedDim) {
      throw new Error(
        `Embedding dim mismatch: provider returned ${vec.length}, store is ${this.db.embedDim}. ` +
          `Re-initialize the store or keep the same embeddings provider.`
      );
    }

    const rowid = BigInt(memoryId);
    this.db.raw
      .prepare('DELETE FROM memories_vec WHERE rowid = ?')
      .run(rowid);
    this.db.raw
      .prepare('INSERT INTO memories_vec (rowid, embedding) VALUES (?, ?)')
      .run(rowid, Buffer.from(new Float32Array(vec).buffer));
  }
}

const BASE_SELECT = `
  SELECT m.id, m.content, m.kind, m.tags_json, s.name AS scope_name,
         m.source, m.created_at, m.updated_at
  FROM memories m
  LEFT JOIN scopes s ON s.id = m.scope_id
`;

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
