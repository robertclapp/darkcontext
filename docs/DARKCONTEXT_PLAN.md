@@ -0,0 +1,225 @@
# DarkContext — Bring-Your-Own-Context for LLMs

## Context

You want a **user-controlled context layer** that lets people store their own memories, conversation history, documents, and workspace state once, and expose them to any LLM or AI tool (Claude Desktop, Cursor, ChatGPT, Gemini, etc.) they choose to connect. LLMs can share context through it. The user decides which tool sees what.

**Why now:** Every AI tool reinvents memory in a silo. Your ChatGPT doesn't know what Claude knows. Switching models means starting over. A portable, self-hosted context layer solves that.

**Why not just extend DarkGate:** DarkGate is a single-user CLI for spec generation — different product, different shape. DarkContext is a long-running service with auth, a database, and a network surface. We'll borrow a couple of patterns (LLM provider abstraction, layered config) but not share a codebase.

## Decisions locked

| Axis | Choice |
|---|---|
| Repo | **New repo `DarkContext`** |
| Integration | **MCP server** (STDIO + HTTP transports) |
| Storage | **Self-hosted local-first** (SQLite + `sqlite-vec`) |
| Context scope (v1) | Memories/facts, conversation history, documents, workspace state |
| Stack | **TypeScript / Node 20+** |
| Embeddings | **Local default** — Ollama (`nomic-embed-text`), ONNX fallback via `@xenova/transformers` |
| Access control | **Per-tool scopes/namespaces**, token-based |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  LLM Tools (Claude Desktop, Cursor, ChatGPT via adapter)│
└──────────────┬──────────────────────────────────────────┘
               │ MCP (stdio or HTTP + bearer token)
┌──────────────▼──────────────────────────────────────────┐
│ DarkContext MCP Server                                  │
│  ├─ tools: recall, remember, forget, search_documents,  │
│  │          search_history, workspace_* …               │
│  ├─ scope filter (enforces per-tool grants on every call)│
│  └─ auth (bearer token → tool identity)                 │
├─────────────────────────────────────────────────────────┤
│ Core domains                                            │
│  ├─ memories   ├─ documents   ├─ conversations          │
│  ├─ workspaces ├─ embeddings  ├─ scopes/grants          │
│  └─ importers (chatgpt, claude, gemini takeout, json)   │
├─────────────────────────────────────────────────────────┤
│ Storage: SQLite (better-sqlite3) + sqlite-vec extension │
│  single file: ~/.darkcontext/store.db                   │
└─────────────────────────────────────────────────────────┘
         ▲
         │ admin
  `dcx` CLI — add tools, grant scopes, import data, inspect
```

## Repo layout

```
darkcontext/
├── src/
│   ├── mcp/
│   │   ├── server.ts               # MCP server bootstrap (stdio + http)
│   │   ├── auth.ts                 # bearer token → tool identity
│   │   ├── scopeFilter.ts          # enforces grants on every tool call
│   │   └── tools/
│   │       ├── recall.ts           # unified semantic+keyword search
│   │       ├── remember.ts
│   │       ├── forget.ts
│   │       ├── searchDocuments.ts
│   │       ├── searchHistory.ts
│   │       └── workspace.ts        # list/set/get/add
│   ├── core/
│   │   ├── store/
│   │   │   ├── db.ts               # better-sqlite3 + sqlite-vec loader
│   │   │   ├── schema.sql
│   │   │   └── migrations/
│   │   ├── memories/
│   │   ├── documents/              # chunker, ingester
│   │   ├── conversations/
│   │   ├── workspace/
│   │   ├── embeddings/
│   │   │   ├── provider.ts         # EmbeddingProvider interface
│   │   │   ├── ollama.ts
│   │   │   └── onnx.ts
│   │   ├── scopes/                 # CRUD + grant logic
│   │   └── importers/
│   │       ├── chatgpt.ts          # conversations.json
│   │       ├── claude.ts
│   │       ├── gemini.ts           # Google Takeout
│   │       └── generic.ts
│   ├── cli/
│   │   ├── index.ts                # `dcx` entrypoint
│   │   └── commands/               # tool add, scope grant, import, serve, doctor
│   └── types/
├── tests/
│   ├── unit/scopeFilter.test.ts    # CRITICAL — security boundary
│   ├── unit/embeddings.test.ts
│   └── integration/mcp.test.ts     # spin up server, hit via MCP inspector
├── docs/
│   ├── README.md
│   ├── ARCHITECTURE.md
│   ├── MCP_TOOLS.md
│   └── SECURITY.md
├── package.json
└── tsconfig.json
```

## Data model (SQLite)

```sql
-- Identity & access
tools            (id, name, token_hash, created_at, last_seen_at)
scopes           (id, name, description)
tool_scopes      (tool_id, scope_id, can_read, can_write)

-- Memories (atomic facts)
memories         (id, content, kind, tags_json, scope_id,
                  source, created_at, updated_at)
memories_vec     -- sqlite-vec virtual table, 768-dim

-- Documents
documents        (id, title, source_uri, mime, scope_id, ingested_at)
document_chunks  (id, document_id, chunk_idx, content)
document_chunks_vec

-- Conversation history (cross-tool)
conversations    (id, source, external_id, title, started_at, scope_id)
messages         (id, conversation_id, role, content, ts)
messages_vec

-- Workspace / project state
workspaces       (id, name, is_active, scope_id)
workspace_items  (id, workspace_id, kind, content, state, updated_at)
```

`scope_id` on every content row is the enforcement point. Every read/write goes through `scopeFilter.ts`, which rejects anything the calling tool isn't granted.

## MCP tool surface (v1)

| Tool | Purpose |
|---|---|
| `recall(query, kinds?, limit?)` | Unified search across memories/docs/history/workspace |
| `remember(content, kind, tags?)` | Store a memory (scope inferred from tool identity) |
| `forget(id)` | Delete a memory |
| `search_documents(query)` | Document retrieval only |
| `search_history(query, source?)` | Past conversations only |
| `list_workspaces()` / `get_active_workspace()` | Project state |
| `add_to_workspace(kind, content)` | Capture task/goal/thread |

Everything is scope-filtered server-side. No tool can see another tool's scopes unless the user granted it.

## Admin CLI (`dcx`)

- `dcx init` — create `~/.darkcontext/store.db`, run migrations
- `dcx serve [--stdio | --http --port 4000]` — run the MCP server
- `dcx tool add <name> --scopes personal,work [--read-only]` — generates bearer token, prints MCP config snippet
- `dcx tool list` / `dcx tool revoke <name>`
- `dcx scope add <name>` / `dcx scope list`
- `dcx import chatgpt <path>` / `dcx import claude <path>` / `dcx import gemini <path>`
- `dcx doctor` — check Ollama connectivity, embedding model, DB integrity
- `dcx remember "…" --scope work --tags foo,bar` — manual entry

## Primitives to borrow from DarkGate

| DarkGate file | Reuse as |
|---|---|
| `src/core/providers/types.ts` — `LLMProvider` pattern | Shape for `EmbeddingProvider` in `src/core/embeddings/provider.ts` |
| `src/core/project/ProjectContext.ts` — layered config pattern | Shape for `~/.darkcontext/config.json` loader |
| `src/cli/index.ts` — commander structure | `dcx` CLI skeleton |

**Not reusing:** CacheManager (DarkGate-specific), InterviewEngine, SpecGenerator, CrossRefValidator — all orthogonal.

## Phased delivery

**M1 — Foundation (local dev only)**
- Repo scaffold, TS + eslint + vitest + CI
- SQLite schema + migrations, `sqlite-vec` loaded
- `EmbeddingProvider` interface + Ollama adapter + ONNX fallback
- Memories CRUD + vector search
- `dcx init`, `dcx remember`, `dcx recall` (CLI only, no MCP yet)

**M2 — MCP surface**
- MCP server with stdio transport
- `recall` + `remember` + `forget` tools
- Tool/scope model + `dcx tool add` flow
- Scope filter with tests
- Claude Desktop smoke test

**M3 — Full context scope**
- Documents ingestion + chunking + search
- Workspace state + workspace tools
- HTTP/SSE transport with bearer auth

**M4 — Importers**
- ChatGPT `conversations.json`
- Claude export
- Gemini Takeout
- Generic JSON schema

**M5 — Hardening**
- Encryption-at-rest option (SQLCipher)
- Audit log (every tool call logged with tool_id + args)
- Backup/restore commands
- Docs: ARCHITECTURE, SECURITY, MCP_TOOLS

## Verification

- **Unit:** `scopeFilter.test.ts` — exhaustive matrix of tool/scope/read/write combinations. This is the security boundary; it must not leak.
- **Unit:** embedding provider conformance tests (Ollama + ONNX return same-shape vectors).
- **Integration:** spin up `dcx serve --stdio`, drive it with `@modelcontextprotocol/inspector`, verify recall honors scopes.
- **End-to-end smoke:** configure Claude Desktop with a generated token, run `remember` then `recall` from a fresh Claude chat, confirm retrieval.
- **Importer golden files:** sample exports committed to `tests/fixtures/`, assert parsed row counts and scope assignment.
- **Manual:** connect a second tool (Cursor) with a different scope, prove it cannot see the first tool's memories.

## Repo creation — what you need to do

My GitHub MCP access is scoped to `robertclapp/darkgate`. I **cannot** create `robertclapp/darkcontext` from this session. Options:

1. **You create the empty repo** on GitHub (`robertclapp/darkcontext`, empty, no README) and grant this session access to it — then I scaffold everything and push.
2. **I scaffold locally** at `/home/user/DarkContext` on a feature branch and hand you the commits; you create the remote and push.
3. **Expand MCP access** to let me create repos under your account.

Recommend option 1 for speed.

## Critical files (once scaffolded)

- `src/mcp/scopeFilter.ts` — security boundary
- `src/core/store/schema.sql` — data model
- `src/core/embeddings/provider.ts` — abstraction for swap-in providers
- `src/cli/commands/tool.ts` — token issuance UX (most-used admin flow)
- `docs/SECURITY.md` — threat model, scope semantics, token handling
