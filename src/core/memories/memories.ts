import type { DarkContextDb } from '../store/db.js';
import { VectorIndex } from '../store/vectorIndex.js';
import { resolveScopeOrDefault } from '../store/scopeHelpers.js';
import { buildFtsQuery, isFtsAvailable } from '../store/fts.js';
import { cached } from '../store/preparedCache.js';
import type { EmbeddingProvider } from '../embeddings/provider.js';
import { NotFoundError, ValidationError } from '../errors.js';
import {
  DEFAULT_DEDUP_DISTANCE,
  DEFAULT_MEMORY_KIND,
  DEFAULT_SCOPE_NAME,
} from '../constants.js';

import type {
  Memory,
  NewMemory,
  RecallHit,
  RecallOptions,
  RememberOrMergeResult,
} from './types.js';

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
    if (!input.content.trim()) throw new ValidationError('content', 'must not be empty');
    const now = Date.now();
    const kind = input.kind ?? DEFAULT_MEMORY_KIND;
    const tags = input.tags ?? [];
    const source = input.source ?? null;
    const scopeName = input.scope ?? DEFAULT_SCOPE_NAME;
    const scopeId = resolveScopeOrDefault(this.db.raw, input.scope);

    const info = this.db.raw
      .prepare(
        `INSERT INTO memories (content, kind, tags_json, scope_id, source, created_at, updated_at)
         VALUES (@content, @kind, @tags_json, @scope_id, @source, @now, @now)`
      )
      .run({
        content: input.content,
        kind,
        tags_json: JSON.stringify(tags),
        scope_id: scopeId,
        source,
        now,
      });

    const id = Number(info.lastInsertRowid);
    // Embed after the insert so a failing provider can't block the write
    // — the FTS triggers have already indexed the content and a future
    // `dcx reindex` can populate the vector row.
    await this.vectors.write([id], [input.content]);

    // Build the returned row from known values rather than round-tripping
    // through SELECT. The DB only adds `id`; every other field was set above.
    return { id, content: input.content, kind, tags, scope: scopeName, source, createdAt: now, updatedAt: now };
  }

  getById(id: number): Memory {
    const row = this.db.raw
      .prepare(`${BASE_SELECT} WHERE m.id = ?`)
      .get(id) as MemoryRow | undefined;
    if (!row) throw new NotFoundError('memory', id);
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

  /**
   * Like `remember`, but first looks for a semantically near-duplicate in
   * the same scope. If one is found (top-1 vector distance below
   * `threshold`), that row's content is replaced with the new content,
   * tags are unioned, and the optional `source` overwrites the existing
   * value. No new row is inserted.
   *
   * Returns `{ memory, merged }` so callers can distinguish the two
   * outcomes. Falls back to a plain insert when vector search is
   * unavailable (no sqlite-vec, no embed dimension yet) — dedup is a
   * best-effort quality-of-life feature, not a correctness invariant.
   *
   * Only considers candidates in the SAME scope as the incoming memory.
   * Cross-scope merges would leak existence across scope boundaries,
   * which the ScopeFilter contract forbids.
   */
  async rememberOrMerge(
    input: NewMemory,
    threshold: number = DEFAULT_DEDUP_DISTANCE
  ): Promise<RememberOrMergeResult> {
    if (!input.content.trim()) throw new ValidationError('content', 'must not be empty');
    if (!Number.isFinite(threshold) || threshold < 0) {
      throw new ValidationError('threshold', `must be a non-negative number, got ${threshold}`);
    }

    const scopeName = input.scope ?? DEFAULT_SCOPE_NAME;
    const candidate = await this.findDuplicate(input.content, scopeName, threshold);
    if (candidate) {
      const merged = this.mergeInto(candidate, input);
      // Rewrite the vector for the updated content so recall returns the
      // new phrasing. Triggers already rewrote the FTS row on UPDATE.
      // sqlite-vec virtual tables don't UPSERT, so drop the old row
      // before writing the new embedding.
      this.vectors.deleteOne(merged.id);
      await this.vectors.write([merged.id], [merged.content]);
      return { memory: merged, merged: true };
    }
    const memory = await this.remember(input);
    return { memory, merged: false };
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
    const rows = this.db.raw
      .prepare('SELECT id, content FROM memories ORDER BY id')
      .all() as Array<{ id: number; content: string }>;
    await this.vectors.reindex(
      rows.map((r) => r.id),
      rows.map((r) => r.content)
    );
    return rows.length;
  }

  /**
   * Look for a near-duplicate of `content` within `scopeName`. Returns
   * the candidate memory when the top vector-match distance is below
   * `threshold`, else null.
   *
   * Vector-only. If vectors are unavailable we deliberately return null
   * rather than falling back to FTS/LIKE: keyword overlap is not a
   * reliable duplicate signal ("I love coffee" and "I hate coffee" share
   * every non-stop word), and a false-positive merge silently deletes
   * the user's content.
   */
  private async findDuplicate(
    content: string,
    scopeName: string,
    threshold: number
  ): Promise<Memory | null> {
    if (!this.db.hasVec || this.db.embedDim === 0) return null;
    const [qv] = await this.embeddings.embed([content]);
    if (!qv) return null;
    const row = this.db.raw
      .prepare(
        `SELECT m.id, m.content, m.kind, m.tags_json, s.name AS scope_name,
                m.source, m.created_at, m.updated_at, v.distance AS distance
         FROM memories_vec v
         JOIN memories m ON m.id = v.rowid
         LEFT JOIN scopes s ON s.id = m.scope_id
         WHERE v.embedding MATCH ? AND k = 1 AND s.name = ?
         ORDER BY v.distance
         LIMIT 1`
      )
      .get(VectorIndex.queryBlob(qv), scopeName) as
      | (MemoryRow & { distance: number })
      | undefined;
    // Strict `<`: threshold 0 disables merging entirely (no row qualifies),
    // which is how callers signal "opt-out" without a separate flag. Real
    // embedding providers produce distance > 0 even on identical strings
    // due to float math, so 0.15 still catches them.
    if (!row || row.distance >= threshold) return null;
    return rowToMemory(row);
  }

  /**
   * Replace `target`'s content with `input.content`, union tags, and
   * overwrite `source` when the caller provided one. Writes the UPDATE
   * and returns the fresh Memory shape. Does NOT touch the vector index
   * — the caller is responsible for rewriting it after merge.
   */
  private mergeInto(target: Memory, input: NewMemory): Memory {
    const tags = Array.from(new Set([...target.tags, ...(input.tags ?? [])]));
    const source = input.source ?? target.source;
    const kind = input.kind ?? target.kind;
    const now = Date.now();
    this.db.raw
      .prepare(
        `UPDATE memories
         SET content = ?, tags_json = ?, source = ?, kind = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(input.content, JSON.stringify(tags), source, kind, now, target.id);
    return {
      id: target.id,
      content: input.content,
      kind,
      tags,
      scope: target.scope,
      source,
      createdAt: target.createdAt,
      updatedAt: now,
    };
  }

  private vectorRecall(qv: number[], limit: number, scope?: string): RecallHit[] {
    const sql = scope ? VECTOR_RECALL_SCOPED : VECTOR_RECALL_UNSCOPED;
    const stmt = cached(this.db.raw, sql);
    const rows = (scope
      ? stmt.all(VectorIndex.queryBlob(qv), limit, scope)
      : stmt.all(VectorIndex.queryBlob(qv), limit)) as (MemoryRow & { distance: number })[];
    return rows.map((r) => ({
      memory: rowToMemory(r),
      score: 1 / (1 + r.distance),
      match: 'vector' as const,
    }));
  }

  /**
   * Lexical fallback when vector search is unavailable (no sqlite-vec, or
   * `embedDim === 0` because nothing has been embedded yet).
   *
   * Prefers FTS5 — unicode61 tokenizer, implicit AND across terms, bm25
   * ranking via the virtual table's `rank` column. Falls back to plain
   * `LIKE '%query%'` only when FTS5 isn't compiled into SQLite (rare) or
   * the query sanitizes to empty.
   */
  private keywordRecall(query: string, limit: number, scope?: string): RecallHit[] {
    const ftsQuery = buildFtsQuery(query);
    if (isFtsAvailable(this.db.raw) && ftsQuery.length > 0) {
      return this.ftsRecall(ftsQuery, limit, scope);
    }
    return this.likeRecall(query, limit, scope);
  }

  private ftsRecall(ftsQuery: string, limit: number, scope?: string): RecallHit[] {
    const sql = scope ? FTS_RECALL_SCOPED : FTS_RECALL_UNSCOPED;
    const stmt = cached(this.db.raw, sql);
    const rows = (scope
      ? stmt.all(ftsQuery, scope, limit)
      : stmt.all(ftsQuery, limit)) as (MemoryRow & { rank: number })[];
    // FTS5 rank is negative (more-negative = better). Normalize to (0, 1].
    return rows.map((r) => ({
      memory: rowToMemory(r),
      score: Math.min(1, 1 / (1 + Math.abs(r.rank))),
      match: 'keyword' as const,
    }));
  }

  private likeRecall(query: string, limit: number, scope?: string): RecallHit[] {
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
      score: 0.3,
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

// Hot-path SQL kept as module-level constants so `cached()` can memoize the
// prepared statement by reference. Two variants per search: with and without
// the scope filter — bounded cache growth, fully expressible as static SQL.

const VECTOR_RECALL_UNSCOPED = `
  SELECT m.id AS id, m.content, m.kind, m.tags_json, s.name AS scope_name,
         m.source, m.created_at, m.updated_at, v.distance AS distance
  FROM memories_vec v
  JOIN memories m ON m.id = v.rowid
  LEFT JOIN scopes s ON s.id = m.scope_id
  WHERE v.embedding MATCH ? AND k = ?
  ORDER BY v.distance
`;

const VECTOR_RECALL_SCOPED = `
  SELECT m.id AS id, m.content, m.kind, m.tags_json, s.name AS scope_name,
         m.source, m.created_at, m.updated_at, v.distance AS distance
  FROM memories_vec v
  JOIN memories m ON m.id = v.rowid
  LEFT JOIN scopes s ON s.id = m.scope_id
  WHERE v.embedding MATCH ? AND k = ? AND s.name = ?
  ORDER BY v.distance
`;

const FTS_RECALL_UNSCOPED = `
  SELECT m.id, m.content, m.kind, m.tags_json, s.name AS scope_name,
         m.source, m.created_at, m.updated_at, f.rank AS rank
  FROM memories_fts f
  JOIN memories m ON m.id = f.rowid
  LEFT JOIN scopes s ON s.id = m.scope_id
  WHERE memories_fts MATCH ?
  ORDER BY f.rank
  LIMIT ?
`;

const FTS_RECALL_SCOPED = `
  SELECT m.id, m.content, m.kind, m.tags_json, s.name AS scope_name,
         m.source, m.created_at, m.updated_at, f.rank AS rank
  FROM memories_fts f
  JOIN memories m ON m.id = f.rowid
  LEFT JOIN scopes s ON s.id = m.scope_id
  WHERE memories_fts MATCH ? AND s.name = ?
  ORDER BY f.rank
  LIMIT ?
`;
