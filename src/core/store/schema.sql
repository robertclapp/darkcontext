-- DarkContext schema (M1 subset)
-- Vector tables created separately in db.ts so embed dim can vary per provider.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Identity & access (stubs used in M1, enforced in M2)
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

-- Seed a default scope so M1 CLI usage works without extra setup.
INSERT OR IGNORE INTO scopes (name, description)
VALUES ('default', 'Default scope for unscoped CLI usage');
