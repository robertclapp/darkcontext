-- DarkContext schema.
-- Applied idempotently on every `openDb()` — additive changes only.
-- Vector tables (memories_vec, document_chunks_vec, messages_vec) are
-- created separately in db.ts so their FLOAT[N] dim can track the active
-- embedding provider. Pragmas (journal_mode, foreign_keys) and the `meta`
-- table bootstrap are handled in db.ts BEFORE this file is executed, so
-- schema.sql starts its lifetime with `meta.schema_version` readable.

-- Identity & access
CREATE TABLE IF NOT EXISTS tools (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  token_hash   TEXT    NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE TABLE IF NOT EXISTS scopes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  description TEXT
);

-- Per-scope retention policy. Rows older than `now - retention_days*86400000`
-- in content tables get removed by `dcx prune`. A row here is OPT-IN:
-- scopes with no row retain data forever. The table is separate from
-- `scopes` so the additive-only schema rule still holds for existing
-- databases (adding a column to `scopes` wouldn't apply to stores that
-- predate it).
CREATE TABLE IF NOT EXISTS scope_retention (
  scope_id       INTEGER PRIMARY KEY REFERENCES scopes(id) ON DELETE CASCADE,
  retention_days INTEGER NOT NULL CHECK (retention_days > 0),
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_scopes (
  tool_id   INTEGER NOT NULL REFERENCES tools(id)  ON DELETE CASCADE,
  scope_id  INTEGER NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,
  can_read  INTEGER NOT NULL DEFAULT 1,
  can_write INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (tool_id, scope_id)
);

-- Memories (atomic facts)
CREATE TABLE IF NOT EXISTS memories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  content    TEXT    NOT NULL,
  kind       TEXT    NOT NULL DEFAULT 'fact',
  tags_json  TEXT    NOT NULL DEFAULT '[]',
  scope_id   INTEGER REFERENCES scopes(id) ON DELETE SET NULL,
  source     TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_scope      ON memories(scope_id);
CREATE INDEX IF NOT EXISTS idx_memories_kind       ON memories(kind);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);

-- Documents (long-form content, chunked for retrieval)
CREATE TABLE IF NOT EXISTS documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  source_uri  TEXT,
  mime        TEXT    NOT NULL DEFAULT 'text/plain',
  scope_id    INTEGER REFERENCES scopes(id) ON DELETE SET NULL,
  ingested_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_scope ON documents(scope_id);
CREATE INDEX IF NOT EXISTS idx_documents_title ON documents(title);

CREATE TABLE IF NOT EXISTS document_chunks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_idx   INTEGER NOT NULL,
  content     TEXT    NOT NULL,
  UNIQUE (document_id, chunk_idx)
);

CREATE INDEX IF NOT EXISTS idx_chunks_document ON document_chunks(document_id);

-- Workspaces (active project / context container)
CREATE TABLE IF NOT EXISTS workspaces (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT    NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 0,
  scope_id  INTEGER REFERENCES scopes(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL,
  content      TEXT    NOT NULL,
  state        TEXT    NOT NULL DEFAULT 'open',
  updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wsitems_workspace ON workspace_items(workspace_id);
CREATE INDEX IF NOT EXISTS idx_wsitems_state     ON workspace_items(state);

-- Conversation history (cross-tool import target)
CREATE TABLE IF NOT EXISTS conversations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT    NOT NULL,
  external_id TEXT,
  title       TEXT    NOT NULL,
  started_at  INTEGER NOT NULL,
  scope_id    INTEGER REFERENCES scopes(id) ON DELETE SET NULL,
  UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_source     ON conversations(source);
CREATE INDEX IF NOT EXISTS idx_conv_scope      ON conversations(scope_id);
CREATE INDEX IF NOT EXISTS idx_conv_started_at ON conversations(started_at);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT    NOT NULL,
  content         TEXT    NOT NULL,
  ts              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_ts           ON messages(ts);

-- Audit log: one row per MCP tool invocation. Never pruned automatically;
-- operators can trim via `dcx audit prune --before <iso>`.
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER NOT NULL,
  tool_id    INTEGER REFERENCES tools(id) ON DELETE SET NULL,
  tool_name  TEXT    NOT NULL,
  mcp_tool   TEXT    NOT NULL,
  args_json  TEXT    NOT NULL,
  outcome    TEXT    NOT NULL,   -- 'ok' | 'denied' | 'error'
  error      TEXT,
  duration_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_ts       ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_tool     ON audit_log(tool_id);
CREATE INDEX IF NOT EXISTS idx_audit_outcome  ON audit_log(outcome);

-- Lexical search indexes (SQLite FTS5). These are "contentless" external-
-- content tables: each FTS row is keyed by the rowid of the content table
-- and stores only the tokenized columns for the matching engine. We keep
-- these in sync via triggers below so callers don't have to remember.

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  tokenize = 'unicode61 remove_diacritics 2',
  content = 'memories',
  content_rowid = 'id'
);

CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO memories_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
  content,
  tokenize = 'unicode61 remove_diacritics 2',
  content = 'document_chunks',
  content_rowid = 'id'
);

CREATE TRIGGER IF NOT EXISTS document_chunks_ai AFTER INSERT ON document_chunks BEGIN
  INSERT INTO document_chunks_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS document_chunks_ad AFTER DELETE ON document_chunks BEGIN
  INSERT INTO document_chunks_fts(document_chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS document_chunks_au AFTER UPDATE ON document_chunks BEGIN
  INSERT INTO document_chunks_fts(document_chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO document_chunks_fts(rowid, content) VALUES (new.id, new.content);
END;

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  tokenize = 'unicode61 remove_diacritics 2',
  content = 'messages',
  content_rowid = 'id'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

-- Seed a default scope so M1 CLI usage works without extra setup.
INSERT OR IGNORE INTO scopes (name, description)
VALUES ('default', 'Default scope for unscoped CLI usage');
