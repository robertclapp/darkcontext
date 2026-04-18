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
│  ├─ ScopeFilter          <- SECURITY BOUNDARY           │
│  ├─ withAudit() wrapper  <- every tool call is logged   │
│  └─ tools: declarative McpToolDef per file              │
│             aggregated in tools/registry.ts             │
├─────────────────────────────────────────────────────────┤
│ Core domains                                            │
│  memories   documents   conversations   workspaces      │
│  embeddings (stub | ollama | onnx)                      │
│  scopes + tools (identity + grants, sha256 token hash)  │
│  importers (chatgpt, claude, gemini, generic)           │
│  audit (fail-closed redaction)                          │
├─────────────────────────────────────────────────────────┤
│ Storage                                                 │
│  SQLite (better-sqlite3)                                │
│   + sqlite-vec   (semantic; vec0 virtual tables)        │
│   + FTS5         (lexical; triggers keep it synced)     │
│  prepared-statement cache (per Database)                │
│  ~/.darkcontext/store.db (WAL, optional SQLCipher)      │
└─────────────────────────────────────────────────────────┘
         ▲
         │ admin
  `dcx` CLI — init/tool/scope/ingest/import/backup/audit/reindex/serve
```

## Layers

### Foundation (`src/core/`)

- **`config.ts` + `loadConfig(overrides, env)`** — single canonical
  resolver for every env-derived setting. Tests build config literals;
  production reads from `process.env`. Bad values surface as
  `ConfigError` at load time.
- **`constants.ts`** — named tunables (schema version, chunk size,
  audit redaction limit, …) with rationale comments so a future reader
  knows whether a value is load-bearing or arbitrary.
- **`errors.ts`** — `DarkContextError` hierarchy. MCP + CLI classify
  by type, never by string-matching.
- **`context.ts` / `AppContext`** — the DI container. Owns the DB and
  every domain module. Entry points: `AppContext.open(init)` for
  caller-owned lifetime and `AppContext.run(init, fn)` for scoped use.
  `close()` is idempotent. Test fixture and every CLI command are
  built on top.

### Storage (`src/core/store/`)

- `schema.sql` is the single source of truth. Applied with
  `CREATE TABLE IF NOT EXISTS` on every `openDb`, so the schema file
  is also the migration path (additive changes only).
- `db.ts` runs eight ordered phases: open file → SQLCipher key →
  pragmas → load sqlite-vec → bootstrap `meta` → read + verify
  `schema_version` → apply full schema → stamp version. Rejects stores
  written by a newer binary (`ConfigError`).
- Three indexing layers, kept in sync by triggers:
  - `memories_vec` / `document_chunks_vec` / `messages_vec` —
    sqlite-vec virtual tables (`vec0(embedding FLOAT[N])`), rowid =
    id of the source row.
  - `memories_fts` / `document_chunks_fts` / `messages_fts` — FTS5
    contentless external-content tables for lexical fallback.
- `vectorIndex.ts` — `write()` (propagates embedding errors) and
  atomic `reindex(ids, texts)` (embed first, swap inside one tx).
  Binds rowids as BigInt because better-sqlite3 binds JS Number as
  FLOAT which sqlite-vec rejects.
- `preparedCache.ts` — `cached(db, sql)` memoizes prepared statements
  per-connection. Used on the MCP hot path where the server reuses
  one Memories/Documents/Conversations instance across many calls.
- `fts.ts` — `isFtsAvailable` + `buildFtsQuery`, which sanitizes user
  input against FTS5 operator injection.
- `scopeHelpers.ts` — `resolveScopeId` / `resolveScopeOrDefault`
  consolidated so every insert path shares one lookup.

### Domain modules

Each owns: schema mapping, CRUD, vector-or-FTS5-or-LIKE search, and
(where applicable) embedding calls. They are **unscoped** — they do
not know about the calling MCP tool. The admin CLI uses them
directly; the MCP surface always routes through `ScopeFilter`.

### MCP (`src/mcp/`)

- `scopeFilter.ts` — the security boundary. Methods: `remember`,
  `recall`, `forget`, `ingestDocument`, `searchDocuments`,
  `searchHistory`, `listWorkspaces`, `getActiveWorkspace`,
  `addToWorkspace`. Rules: reads restrict to readable scopes;
  writes require writable grants; cross-scope deletes return
  no-data rather than errors to prevent existence leaks.
  Raises `ScopeDeniedError` for explicit unreadable/unwritable targets.
- `audit.ts` — `withAudit(auditor, caller, toolName, handler)`.
  Classifies outcomes structurally (ScopeDeniedError → `denied`,
  any other throw → `error`). Redacts args using the fail-closed
  policy in `core/audit/audit.ts`.
- `tools/types.ts` — `defineTool({...})` with Zod-inferred args.
  `tools/registry.ts` exports `ALL_MCP_TOOLS` and a single
  `registerAllMcpTools` loop. Adding a tool = one new file + one
  line in the array.
- `auth.ts` — stdio auth reads `DARKCONTEXT_TOKEN` from env.
- `httpServer.ts` — Streamable HTTP transport behind constant-time
  bearer check (sha256 + `timingSafeEqual`).

### CLI (`src/cli/`)

Every command file exports a `runX(args, opts, out)` pure function
and a thin `registerX(program)` commander wrapper. `withAppContext`
is the single place that opens an AppContext, runs the action, and
closes on the way out.

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

-- search indexes (kept in sync by triggers)
memories_vec         vec0(embedding FLOAT[N])   -- rowid = memories.id
memories_fts         fts5(content)              -- rowid = memories.id
document_chunks_vec  vec0(embedding FLOAT[N])
document_chunks_fts  fts5(content)
messages_vec         vec0(embedding FLOAT[N])
messages_fts         fts5(content)

-- audit + meta
audit_log        (id, ts, tool_id, tool_name, mcp_tool, args_json, outcome, error, duration_ms)
meta             (key, value)  -- schema_version, embed_dim
```

## Extending

- **New content domain**: schema rows, a `core/<domain>` module with
  CRUD + search + VectorIndex, new methods on `ScopeFilter`, a new
  `defineTool` file, registry entry, CLI command, tests. Follow
  `memories/`.
- **New MCP tool**: `src/mcp/tools/<name>.ts` + one line in
  `registry.ts`. No other wiring needed.
- **New importer**: implement the `Importer` interface (pure,
  `parse(raw)` → `ImportedConversation[]`), register in
  `importers/index.ts`, add a fixture + parser test + CLI subcommand.
- **New transport**: build a `Transport`, call
  `buildServer(filter, auditor).connect(transport)`.
- **New eval**: add `evals/<name>/run.ts` using `harness.ts`. Add an
  `eval:<name>` npm script.
