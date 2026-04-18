# DarkContext — Architecture

```
┌─────────────────────────────────────────────────────────┐
│  LLM Tools (Claude Desktop, Cursor, ChatGPT, Gemini …)  │
└──────────────┬──────────────────────────────────────────┘
               │ MCP: stdio OR Streamable HTTP (+ bearer)
┌──────────────▼──────────────────────────────────────────┐
│ DarkContext MCP Server                                  │
│  ├─ transports: stdio, streamable HTTP                  │
│  ├─ auth: DARKCONTEXT_TOKEN (stdio) / Bearer (http)     │
│  ├─ ScopeFilter  <-- the SECURITY BOUNDARY              │
│  ├─ AuditLog: one row per tool invocation (redacted)    │
│  └─ tools: remember, recall, forget, search_documents,  │
│            search_history, list_workspaces,             │
│            get_active_workspace, add_to_workspace       │
├─────────────────────────────────────────────────────────┤
│ Core domains                                            │
│  memories   documents   conversations   workspaces      │
│  embeddings (stub | ollama | onnx)                      │
│  scopes + tools (identity + grants, sha256 token hash)  │
│  importers (chatgpt, claude, gemini, generic)           │
├─────────────────────────────────────────────────────────┤
│ Storage                                                 │
│  SQLite (better-sqlite3) + sqlite-vec virtual tables    │
│  ~/.darkcontext/store.db (WAL journal)                  │
│  optional SQLCipher at rest (see SECURITY.md)           │
└─────────────────────────────────────────────────────────┘
         ▲
         │ admin
  `dcx` CLI — init/tool/scope/ingest/import/backup/audit/serve
```

## Layers

### Storage (`src/core/store/`)

- `schema.sql` is the single source of truth. It is applied with
  `CREATE TABLE IF NOT EXISTS` on every `openDb`, so the schema file is
  also the migration path (additive changes only).
- `db.ts` loads sqlite-vec opportunistically. If the platform binary is
  missing, the server keeps working — vector operations silently degrade
  to LIKE-based keyword search.
- `ensureVecTables` creates three vector tables — `memories_vec`,
  `document_chunks_vec`, `messages_vec` — all of them `vec0(embedding
  FLOAT[N])`, where `N` is the dim observed from the first provider
  response and pinned in the `meta` table. Swapping providers to one with
  a different dim requires resetting the store or running `dcx reindex`
  after a manual reset.
- `scopeHelpers.ts` owns `resolveScopeId` / `defaultScopeId` /
  `resolveScopeOrDefault` — used by every domain's insert path so scope
  creation is consistent.
- `vectorIndex.ts` owns the three tricky invariants around sqlite-vec:
    - `rowid` must be bound as BigInt (better-sqlite3 binds JS Number as
      FLOAT, which sqlite-vec rejects).
    - First successful write pins `embedDim` in `meta`; mismatches throw
      rather than corrupt the index.
    - Embedding-provider errors do not roll back the caller's content
      insert — missing vectors are recoverable with `dcx reindex`.

### Domain modules (`src/core/*`)

Each module owns: schema mapping, CRUD, vector-or-keyword search, and
optional embedding calls. They are **unscoped** — they do not know about
the calling MCP tool. The admin CLI uses them directly; the MCP surface
always routes through `ScopeFilter`.

- `memories/`   — atomic facts.
- `documents/`  — chunked long-form content (paragraph/sentence-aware
  splitter in `chunker.ts`).
- `conversations/` — imported LLM-chat histories; dedup by `(source,
  external_id)` so re-imports are idempotent.
- `workspaces/` — project/session containers; single-active invariant
  enforced in a transaction.
- `embeddings/` — `EmbeddingProvider` interface + `stub` (default),
  `ollama`, `onnx` (lazy-loaded `@xenova/transformers`).
- `tools/` and `scopes/` — identity model, token generation/hashing.
- `importers/` — pure, I/O-free parsers for ChatGPT, Claude, Gemini
  (Takeout JSON), and a generic shape.
- `audit/` — audit log writer with per-field redaction (any `content`,
  `text`, `query`, or `body` string is replaced with a length summary).

### MCP (`src/mcp/`)

- `server.ts` — `buildServer(filter, auditor, caller)` assembles the
  McpServer with all 8 tools and the audit wrapper.
- `scopeFilter.ts` — the security boundary. Every MCP tool method
  passes through read/write grant checks before touching the underlying
  domain. `forget` and cross-scope reads return no-data rather than
  errors to avoid leaking existence.
- `auth.ts` — stdio auth reads `DARKCONTEXT_TOKEN` from env.
- `httpServer.ts` — Streamable HTTP transport behind constant-time
  bearer check (sha256 comparison). Stateless; one process per tool
  identity.
- `audit.ts` — `withAudit` wrapper that times each tool call, classifies
  the outcome as `ok | denied | error`, redacts args, and appends to the
  audit log.

### CLI (`src/cli/`)

Commander tree of admin commands. The CLI never goes through
`ScopeFilter` — it is the operator's power tool.

## Data model

```sql
-- identity
tools            (id, name, token_hash, created_at, last_seen_at)
scopes           (id, name, description)
tool_scopes      (tool_id, scope_id, can_read, can_write)

-- content
memories         (id, content, kind, tags_json, scope_id, source, created_at, updated_at)
documents        (id, title, source_uri, mime, scope_id, ingested_at)
document_chunks  (id, document_id, chunk_idx, content)
conversations    (id, source, external_id, title, started_at, scope_id)
messages         (id, conversation_id, role, content, ts)
workspaces       (id, name, is_active, scope_id, created_at)
workspace_items  (id, workspace_id, kind, content, state, updated_at)

-- vectors (dim fixed per store)
memories_vec         vec0(embedding FLOAT[N])   -- rowid = memories.id
document_chunks_vec  vec0(embedding FLOAT[N])   -- rowid = document_chunks.id
messages_vec         vec0(embedding FLOAT[N])   -- rowid = messages.id

-- audit
audit_log        (id, ts, tool_id, tool_name, mcp_tool, args_json, outcome, error, duration_ms)
```

## Extending

- New content domain: add schema rows, a `Core/<domain>` module with
  CRUD + search, new methods on `ScopeFilter`, an MCP tool, a CLI
  command, and tests. Follow the shape of `memories/`.
- New importer: implement `Importer` (pure, `parse(raw: string)` →
  `ImportedConversation[]`), register in `importers/index.ts`, add a
  fixture + parser test + CLI subcommand. No other layer needs to change.
- New transport: build a `Transport` from the MCP SDK and call
  `buildServer(filter, auditor, caller).connect(transport)`. The server
  is transport-agnostic.
