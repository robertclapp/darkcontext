import type { DarkContextDb } from '../store/db.js';
import { ValidationError } from '../errors.js';

/**
 * A canonical, ID-free snapshot of a DarkContext store.
 *
 * IDs are store-local and intentionally omitted — a future `dcx import`
 * would regenerate them. Embeddings and FTS are also omitted because they
 * are derivative: a fresh `dcx reindex` rebuilds them from `content`.
 * Tool tokens and the audit log are excluded by default; they can leak
 * identity and activity patterns. Add them explicitly if you need a
 * full forensic dump.
 */
export const EXPORT_VERSION = '1';

export interface ExportMemory {
  content: string;
  kind: string;
  tags: string[];
  scope: string | null;
  source: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ExportDocumentChunk {
  idx: number;
  content: string;
}

export interface ExportDocument {
  title: string;
  sourceUri: string | null;
  mime: string;
  scope: string | null;
  ingestedAt: number;
  chunks: ExportDocumentChunk[];
}

export interface ExportMessage {
  role: string;
  content: string;
  ts: number;
}

export interface ExportConversation {
  source: string;
  externalId: string | null;
  title: string;
  startedAt: number;
  scope: string | null;
  messages: ExportMessage[];
}

export interface ExportWorkspaceItem {
  kind: string;
  content: string;
  state: string;
  updatedAt: number;
}

export interface ExportWorkspace {
  name: string;
  isActive: boolean;
  scope: string | null;
  createdAt: number;
  items: ExportWorkspaceItem[];
}

export interface ExportScope {
  name: string;
  description: string | null;
}

export interface ExportSnapshot {
  version: string;
  exportedAt: number;
  schemaVersion: number;
  scopeFilter: string | null;
  scopes: ExportScope[];
  memories: ExportMemory[];
  documents: ExportDocument[];
  conversations: ExportConversation[];
  workspaces: ExportWorkspace[];
}

export interface ExportOptions {
  /** If set, restrict every section to rows in this scope. */
  scope?: string;
}

/**
 * Build an in-memory snapshot of the store. Streaming is deferred until a
 * user actually hits a store big enough to OOM — the hybrid hot paths
 * already assume the whole memories/documents table fits for reindex, so
 * this matches the existing scale assumption.
 *
 * The entire collection runs inside a single read transaction so
 * concurrent writes can't produce an internally inconsistent snapshot
 * (e.g., a scope listed in `scopes` but no memory referencing it
 * anymore, or vice versa). SQLite's default isolation inside a BEGIN
 * block gives a point-in-time view across multiple prepared statements.
 */
export function exportSnapshot(db: DarkContextDb, opts: ExportOptions = {}): ExportSnapshot {
  // Empty/whitespace `scope` is almost always a caller bug — most often
  // `--scope "$VAR"` with `$VAR` unset. Silently treating it as "no
  // filter" would emit the whole store under a scope-filter claim and
  // can leak data the caller meant to keep scoped. Reject explicitly.
  let scopeFilter: string | null = null;
  if (opts.scope !== undefined) {
    const trimmed = opts.scope.trim();
    if (trimmed === '') {
      throw new ValidationError('scope', 'scope filter must be a non-empty string');
    }
    scopeFilter = trimmed;
  }

  const schemaVersionRow = db.raw
    .prepare(`SELECT value FROM meta WHERE key = 'schema_version'`)
    .get() as { value: string } | undefined;
  const schemaVersion = schemaVersionRow ? Number(schemaVersionRow.value) : 0;

  // `transaction(fn)` returns a wrapper; calling it runs fn inside a
  // SQLite transaction. For a pure-read block, this pins the snapshot
  // so every collector sees the same underlying rows.
  const collect = db.raw.transaction(() => ({
    scopes: collectScopes(db, scopeFilter),
    memories: collectMemories(db, scopeFilter),
    documents: collectDocuments(db, scopeFilter),
    conversations: collectConversations(db, scopeFilter),
    workspaces: collectWorkspaces(db, scopeFilter),
  }));

  return {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    schemaVersion,
    scopeFilter,
    ...collect(),
  };
}

function collectScopes(db: DarkContextDb, scope: string | null): ExportScope[] {
  const rows = scope !== null
    ? (db.raw
        .prepare('SELECT name, description FROM scopes WHERE name = ? ORDER BY name')
        .all(scope) as ExportScope[])
    : (db.raw
        .prepare('SELECT name, description FROM scopes ORDER BY name')
        .all() as ExportScope[]);
  return rows.map((r) => ({ name: r.name, description: r.description ?? null }));
}

interface MemRow {
  content: string;
  kind: string;
  tags_json: string;
  scope_name: string | null;
  source: string | null;
  created_at: number;
  updated_at: number;
}

function collectMemories(db: DarkContextDb, scope: string | null): ExportMemory[] {
  const sql = `
    SELECT m.content, m.kind, m.tags_json, s.name AS scope_name, m.source,
           m.created_at, m.updated_at
    FROM memories m
    LEFT JOIN scopes s ON s.id = m.scope_id
    ${scope !== null ? 'WHERE s.name = ?' : ''}
    ORDER BY m.created_at, m.id
  `;
  const rows = (scope !== null ? db.raw.prepare(sql).all(scope) : db.raw.prepare(sql).all()) as MemRow[];
  return rows.map((r) => ({
    content: r.content,
    kind: r.kind,
    tags: parseTags(r.tags_json),
    scope: r.scope_name,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

interface DocRow {
  id: number;
  title: string;
  source_uri: string | null;
  mime: string;
  scope_name: string | null;
  ingested_at: number;
}

function collectDocuments(db: DarkContextDb, scope: string | null): ExportDocument[] {
  const sql = `
    SELECT d.id, d.title, d.source_uri, d.mime, s.name AS scope_name, d.ingested_at
    FROM documents d
    LEFT JOIN scopes s ON s.id = d.scope_id
    ${scope !== null ? 'WHERE s.name = ?' : ''}
    ORDER BY d.ingested_at, d.id
  `;
  const rows = (scope !== null ? db.raw.prepare(sql).all(scope) : db.raw.prepare(sql).all()) as DocRow[];
  const chunkStmt = db.raw.prepare(
    'SELECT chunk_idx, content FROM document_chunks WHERE document_id = ? ORDER BY chunk_idx'
  );
  return rows.map((r) => {
    const chunks = chunkStmt.all(r.id) as Array<{ chunk_idx: number; content: string }>;
    return {
      title: r.title,
      sourceUri: r.source_uri,
      mime: r.mime,
      scope: r.scope_name,
      ingestedAt: r.ingested_at,
      chunks: chunks.map((c) => ({ idx: c.chunk_idx, content: c.content })),
    };
  });
}

interface ConvRow {
  id: number;
  source: string;
  external_id: string | null;
  title: string;
  started_at: number;
  scope_name: string | null;
}

function collectConversations(db: DarkContextDb, scope: string | null): ExportConversation[] {
  const sql = `
    SELECT c.id, c.source, c.external_id, c.title, c.started_at, s.name AS scope_name
    FROM conversations c
    LEFT JOIN scopes s ON s.id = c.scope_id
    ${scope !== null ? 'WHERE s.name = ?' : ''}
    ORDER BY c.started_at, c.id
  `;
  const rows = (scope !== null ? db.raw.prepare(sql).all(scope) : db.raw.prepare(sql).all()) as ConvRow[];
  const msgStmt = db.raw.prepare(
    'SELECT role, content, ts FROM messages WHERE conversation_id = ? ORDER BY ts, id'
  );
  return rows.map((r) => ({
    source: r.source,
    externalId: r.external_id,
    title: r.title,
    startedAt: r.started_at,
    scope: r.scope_name,
    messages: msgStmt.all(r.id) as ExportMessage[],
  }));
}

interface WsRow {
  id: number;
  name: string;
  is_active: number;
  scope_name: string | null;
  created_at: number;
}

function collectWorkspaces(db: DarkContextDb, scope: string | null): ExportWorkspace[] {
  const sql = `
    SELECT w.id, w.name, w.is_active, s.name AS scope_name, w.created_at
    FROM workspaces w
    LEFT JOIN scopes s ON s.id = w.scope_id
    ${scope !== null ? 'WHERE s.name = ?' : ''}
    ORDER BY w.created_at, w.id
  `;
  const rows = (scope !== null ? db.raw.prepare(sql).all(scope) : db.raw.prepare(sql).all()) as WsRow[];
  const itemStmt = db.raw.prepare(
    'SELECT kind, content, state, updated_at FROM workspace_items WHERE workspace_id = ? ORDER BY updated_at, id'
  );
  return rows.map((r) => ({
    name: r.name,
    isActive: r.is_active === 1,
    scope: r.scope_name,
    createdAt: r.created_at,
    items: (itemStmt.all(r.id) as Array<{
      kind: string;
      content: string;
      state: string;
      updated_at: number;
    }>).map((it) => ({
      kind: it.kind,
      content: it.content,
      state: it.state,
      updatedAt: it.updated_at,
    })),
  }));
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* swallow — malformed tags degrade to empty */
  }
  return [];
}
