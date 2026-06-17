import type { DarkContextDb } from '../store/db.js';
import { VectorIndex } from '../store/vectorIndex.js';
import { resolveScopeOrDefault } from '../store/scopeHelpers.js';
import { buildFtsQuery, isFtsAvailable } from '../store/fts.js';
import { cached } from '../store/preparedCache.js';
import { inClause, widenedVectorSearch, type KnnCandidate } from '../store/vectorSearch.js';
import { normalizeScopeList } from '../store/scopeList.js';
import type { EmbeddingProvider } from '../embeddings/provider.js';
import { NotFoundError, ValidationError } from '../errors.js';
import { DEFAULT_MEMORY_KIND, DEFAULT_SCOPE_NAME } from '../constants.js';

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

  async recall(query: string, opts: RecallOptions = {}): Promise<RecallHit[]> {
    const limit = opts.limit ?? 10;
    const scopes = normalizeScopeList(opts);
    // An explicit empty readable set means "this caller can see nothing".
    if (scopes && scopes.length === 0) return [];
    if (this.db.hasVec && this.db.embedDim > 0) {
      const [qv] = await this.embeddings.embed([query]);
      if (qv) return this.vectorRecall(qv, limit, scopes);
    }
    return this.keywordRecall(query, limit, scopes);
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
   * Vector recall with adaptive widening so a dense neighbouring scope
   * can't crowd in-scope matches out of the candidate window (see
   * store/vectorSearch.ts). Scope filtering happens during hydration, in
   * SQL, against the full window — never as a post-k-NN truncation.
   */
  private vectorRecall(qv: number[], limit: number, scopes?: readonly string[]): RecallHit[] {
    return widenedVectorSearch({
      db: this.db.raw,
      vecTable: 'memories_vec',
      queryVector: qv,
      limit,
      hydrate: (window) => this.hydrateVectorHits(window, scopes),
    });
  }

  /** Hydrate a nearest-neighbour window into scope-filtered hits, ordered
   *  by distance. Returns every survivor (the widening loop slices). */
  private hydrateVectorHits(window: KnnCandidate[], scopes?: readonly string[]): RecallHit[] {
    if (window.length === 0) return [];
    const distById = new Map(window.map((c) => [c.rowid, c.distance]));
    const ids = window.map((c) => c.rowid);
    const scopeFilter = inClause('s.name', scopes);
    const sql = `${BASE_SELECT} WHERE m.id IN (${ids.map(() => '?').join(', ')})${scopeFilter.sql}`;
    const rows = this.db.raw.prepare(sql).all(...ids, ...scopeFilter.params) as MemoryRow[];
    return rows
      .map((r) => ({ row: r, distance: distById.get(r.id) ?? Infinity }))
      .sort((a, b) => a.distance - b.distance)
      .map(({ row, distance }) => ({
        memory: rowToMemory(row),
        score: 1 / (1 + distance),
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
  private keywordRecall(query: string, limit: number, scopes?: readonly string[]): RecallHit[] {
    const ftsQuery = buildFtsQuery(query);
    if (isFtsAvailable(this.db.raw) && ftsQuery.length > 0) {
      return this.ftsRecall(ftsQuery, limit, scopes);
    }
    return this.likeRecall(query, limit, scopes);
  }

  // FTS5 is not a top-k table: it returns every match, the scope IN-filter
  // applies to that full set, and LIMIT truncates last — so the lexical
  // path can't starve the way vec0 does. The scope set is still pushed
  // into SQL for correctness (and to match the vector path's semantics).
  private ftsRecall(ftsQuery: string, limit: number, scopes?: readonly string[]): RecallHit[] {
    const scopeFilter = inClause('s.name', scopes);
    const sql = `
      SELECT m.id, m.content, m.kind, m.tags_json, s.name AS scope_name,
             m.source, m.created_at, m.updated_at, f.rank AS rank
      FROM memories_fts f
      JOIN memories m ON m.id = f.rowid
      LEFT JOIN scopes s ON s.id = m.scope_id
      WHERE memories_fts MATCH ?${scopeFilter.sql}
      ORDER BY f.rank
      LIMIT ?
    `;
    const rows = cached(this.db.raw, sql).all(ftsQuery, ...scopeFilter.params, limit) as (MemoryRow & {
      rank: number;
    })[];
    // FTS5 rank is negative (more-negative = better). Normalize to (0, 1].
    return rows.map((r) => ({
      memory: rowToMemory(r),
      score: Math.min(1, 1 / (1 + Math.abs(r.rank))),
      match: 'keyword' as const,
    }));
  }

  private likeRecall(query: string, limit: number, scopes?: readonly string[]): RecallHit[] {
    const like = `%${query.toLowerCase()}%`;
    const scopeFilter = inClause('s.name', scopes);
    const sql = `
      ${BASE_SELECT}
      WHERE LOWER(m.content) LIKE ?${scopeFilter.sql}
      ORDER BY m.created_at DESC
      LIMIT ?
    `;
    const rows = cached(this.db.raw, sql).all(like, ...scopeFilter.params, limit) as MemoryRow[];
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

