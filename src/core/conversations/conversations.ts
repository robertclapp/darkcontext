import type { DarkContextDb } from '../store/db.js';
import { VectorIndex } from '../store/vectorIndex.js';
import { resolveScopeOrDefault } from '../store/scopeHelpers.js';
import { buildFtsQuery, isFtsAvailable } from '../store/fts.js';
import { cached } from '../store/preparedCache.js';
import type { EmbeddingProvider } from '../embeddings/provider.js';
import { NotFoundError, ValidationError } from '../errors.js';

import type {
  Conversation,
  HistoryHit,
  HistorySearchOptions,
  ImportedConversation,
  IngestResult,
  Message,
} from './types.js';

interface ConvRow {
  id: number;
  source: string;
  external_id: string | null;
  title: string;
  started_at: number;
  scope_name: string | null;
}

interface MsgRow {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  ts: number;
}

interface HitRow extends ConvRow {
  message_id: number;
  m_role: string;
  m_content: string;
  m_ts: number;
  distance?: number;
}

const CONV_SELECT = `
  SELECT c.id, c.source, c.external_id, c.title, c.started_at, s.name AS scope_name
  FROM conversations c
  LEFT JOIN scopes s ON s.id = c.scope_id
`;

export class Conversations {
  private readonly vectors: VectorIndex;

  constructor(
    private readonly db: DarkContextDb,
    private readonly embeddings: EmbeddingProvider
  ) {
    this.vectors = new VectorIndex(db, embeddings, 'messages_vec');
  }

  async ingest(
    source: string,
    items: ImportedConversation[],
    opts: { scope?: string } = {}
  ): Promise<IngestResult> {
    if (!source.trim()) throw new ValidationError('source', 'required');
    const scopeId = resolveScopeOrDefault(this.db.raw, opts.scope);

    let inserted = 0;
    let skipped = 0;
    let messagesTotal = 0;

    const insertedMessageTexts: string[] = [];
    const insertedMessageIds: number[] = [];

    const tx = this.db.raw.transaction(() => {
      const getConv = this.db.raw.prepare(
        'SELECT id FROM conversations WHERE source = ? AND external_id = ?'
      );
      const insConv = this.db.raw.prepare(
        `INSERT INTO conversations (source, external_id, title, started_at, scope_id)
         VALUES (?, ?, ?, ?, ?)`
      );
      const insMsg = this.db.raw.prepare(
        `INSERT INTO messages (conversation_id, role, content, ts) VALUES (?, ?, ?, ?)`
      );

      for (const item of items) {
        const extId = item.externalId ?? null;
        if (extId !== null) {
          const existing = getConv.get(source, extId) as { id: number } | undefined;
          if (existing) {
            skipped++;
            continue;
          }
        }
        const info = insConv.run(source, extId, item.title, item.startedAt, scopeId);
        const convId = Number(info.lastInsertRowid);
        inserted++;
        for (const msg of item.messages) {
          const mi = insMsg.run(convId, msg.role, msg.content, msg.ts);
          insertedMessageIds.push(Number(mi.lastInsertRowid));
          insertedMessageTexts.push(`${msg.role}: ${msg.content}`);
          messagesTotal++;
        }
      }
    });
    tx();

    await this.vectors.write(insertedMessageIds, insertedMessageTexts);

    return { inserted, skipped, messages: messagesTotal };
  }

  list(opts: { source?: string; scope?: string; limit?: number } = {}): Conversation[] {
    const limit = opts.limit ?? 100;
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.source) {
      where.push('c.source = ?');
      params.push(opts.source);
    }
    if (opts.scope) {
      where.push('s.name = ?');
      params.push(opts.scope);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = this.db.raw
      .prepare(`${CONV_SELECT} ${whereSql} ORDER BY c.started_at DESC LIMIT ?`)
      .all(...params, limit) as ConvRow[];
    return rows.map(rowToConv);
  }

  getById(id: number): Conversation {
    const row = this.db.raw
      .prepare(`${CONV_SELECT} WHERE c.id = ?`)
      .get(id) as ConvRow | undefined;
    if (!row) throw new NotFoundError('conversation', id);
    return rowToConv(row);
  }

  messages(conversationId: number): Message[] {
    const rows = this.db.raw
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY ts, id')
      .all(conversationId) as MsgRow[];
    return rows.map(rowToMessage);
  }

  delete(id: number): boolean {
    const tx = this.db.raw.transaction((cid: number) => {
      const ids = (this.db.raw
        .prepare('SELECT id FROM messages WHERE conversation_id = ?')
        .all(cid) as { id: number }[]).map((r) => r.id);
      this.vectors.deleteMany(ids);
      const res = this.db.raw.prepare('DELETE FROM conversations WHERE id = ?').run(cid);
      return res.changes > 0;
    });
    return tx(id) as boolean;
  }

  async search(query: string, opts: HistorySearchOptions = {}): Promise<HistoryHit[]> {
    const limit = opts.limit ?? 10;
    if (this.db.hasVec && this.db.embedDim > 0) {
      const [qv] = await this.embeddings.embed([query]);
      if (qv) return this.vectorSearch(qv, limit, opts);
    }
    return this.keywordSearch(query, limit, opts);
  }

  /** Re-embed every message. Used by `dcx reindex`. Returns message count. */
  async reindex(): Promise<number> {
    const rows = this.db.raw
      .prepare('SELECT id, role, content FROM messages ORDER BY id')
      .all() as Array<{ id: number; role: string; content: string }>;
    await this.vectors.reindex(
      rows.map((r) => r.id),
      rows.map((r) => `${r.role}: ${r.content}`)
    );
    return rows.length;
  }

  private vectorSearch(qv: number[], limit: number, opts: HistorySearchOptions): HistoryHit[] {
    const filters: string[] = [];
    if (opts.scope) filters.push('AND s.name = ?');
    if (opts.source) filters.push('AND c.source = ?');
    const sql = `
      SELECT c.id, c.source, c.external_id, c.title, c.started_at, s.name AS scope_name,
             m.id AS message_id, m.role AS m_role, m.content AS m_content, m.ts AS m_ts,
             v.distance AS distance
      FROM messages_vec v
      JOIN messages m ON m.id = v.rowid
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN scopes s ON s.id = c.scope_id
      WHERE v.embedding MATCH ? AND k = ?
        ${filters.join(' ')}
      ORDER BY v.distance
    `;
    // SQL shape is bounded by the 4 scope x source combinations, so
    // preparedCache memoizes a small, finite set of statements.
    const stmt = cached(this.db.raw, sql);
    const rows = (opts.scope && opts.source
      ? stmt.all(VectorIndex.queryBlob(qv), limit, opts.scope, opts.source)
      : opts.scope
        ? stmt.all(VectorIndex.queryBlob(qv), limit, opts.scope)
        : opts.source
          ? stmt.all(VectorIndex.queryBlob(qv), limit, opts.source)
          : stmt.all(VectorIndex.queryBlob(qv), limit)) as HitRow[];
    return rows.map((r) => rowToHit(r, 'vector'));
  }

  private keywordSearch(query: string, limit: number, opts: HistorySearchOptions): HistoryHit[] {
    const ftsQuery = buildFtsQuery(query);
    if (isFtsAvailable(this.db.raw) && ftsQuery.length > 0) {
      return this.ftsSearch(ftsQuery, limit, opts);
    }
    return this.likeSearch(query, limit, opts);
  }

  private ftsSearch(ftsQuery: string, limit: number, opts: HistorySearchOptions): HistoryHit[] {
    const filters: string[] = [];
    if (opts.scope) filters.push('AND s.name = ?');
    if (opts.source) filters.push('AND c.source = ?');
    const sql = `
      SELECT c.id, c.source, c.external_id, c.title, c.started_at, s.name AS scope_name,
             m.id AS message_id, m.role AS m_role, m.content AS m_content, m.ts AS m_ts,
             f.rank AS rank
      FROM messages_fts f
      JOIN messages m ON m.id = f.rowid
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN scopes s ON s.id = c.scope_id
      WHERE messages_fts MATCH ?
        ${filters.join(' ')}
      ORDER BY f.rank
      LIMIT ?
    `;
    const stmt = cached(this.db.raw, sql);
    const rows = (opts.scope && opts.source
      ? stmt.all(ftsQuery, opts.scope, opts.source, limit)
      : opts.scope
        ? stmt.all(ftsQuery, opts.scope, limit)
        : opts.source
          ? stmt.all(ftsQuery, opts.source, limit)
          : stmt.all(ftsQuery, limit)) as (HitRow & { rank: number })[];
    return rows.map((r) => {
      const hit = rowToHit(r, 'keyword');
      hit.score = Math.min(1, 1 / (1 + Math.abs(r.rank)));
      return hit;
    });
  }

  private likeSearch(query: string, limit: number, opts: HistorySearchOptions): HistoryHit[] {
    const filters: string[] = [];
    const params: unknown[] = [`%${query.toLowerCase()}%`];
    if (opts.scope) {
      filters.push('AND s.name = ?');
      params.push(opts.scope);
    }
    if (opts.source) {
      filters.push('AND c.source = ?');
      params.push(opts.source);
    }
    params.push(limit);
    const sql = `
      SELECT c.id, c.source, c.external_id, c.title, c.started_at, s.name AS scope_name,
             m.id AS message_id, m.role AS m_role, m.content AS m_content, m.ts AS m_ts
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      LEFT JOIN scopes s ON s.id = c.scope_id
      WHERE LOWER(m.content) LIKE ?
        ${filters.join(' ')}
      ORDER BY m.ts DESC
      LIMIT ?
    `;
    const rows = this.db.raw.prepare(sql).all(...params) as HitRow[];
    return rows.map((r) => rowToHit(r, 'keyword'));
  }
}

function rowToConv(r: ConvRow): Conversation {
  return {
    id: r.id,
    source: r.source,
    externalId: r.external_id,
    title: r.title,
    startedAt: r.started_at,
    scope: r.scope_name,
  };
}

function rowToMessage(r: MsgRow): Message {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    role: r.role,
    content: r.content,
    ts: r.ts,
  };
}

function rowToHit(r: HitRow, match: 'vector' | 'keyword'): HistoryHit {
  return {
    conversationId: r.id,
    source: r.source,
    title: r.title,
    scope: r.scope_name,
    messageId: r.message_id,
    role: r.m_role,
    content: r.m_content,
    ts: r.m_ts,
    score: match === 'vector' && r.distance !== undefined ? 1 / (1 + r.distance) : 0.5,
    match,
  };
}
