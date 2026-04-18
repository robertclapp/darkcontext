# DarkContext

[![CI](https://github.com/robertclapp/darkcontext/actions/workflows/ci.yml/badge.svg)](https://github.com/robertclapp/darkcontext/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-stdio%20%7C%20http-8A2BE2)](https://modelcontextprotocol.io)

**Bring-your-own-context for LLMs.** Store memories, documents, conversation
history, and workspace state once — expose it to any MCP-speaking tool
(Claude Desktop, Cursor, Claude Code, ChatGPT via adapter, Gemini, custom
agents) under per-tool scopes you control.

DarkContext is a self-hosted [MCP](https://modelcontextprotocol.io) server
backed by SQLite + [`sqlite-vec`](https://github.com/asg017/sqlite-vec) for
semantic search and FTS5 for lexical fallback. Everything lives in one file at
`~/.darkcontext/store.db` — no cloud, no account, no vendor lock-in.

---

## Table of contents

- [Why DarkContext](#why-darkcontext)
- [Features](#features)
- [Quickstart](#quickstart)
- [Connecting clients](#connecting-clients)
- [Configuration](#configuration)
- [Development](#development)
- [Project layout](#project-layout)
- [Documentation](#documentation)
- [Security](#security)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Why DarkContext

Every AI tool reinvents memory in a silo. Your ChatGPT doesn't know what
Claude knows. Switching models means starting over. DarkContext is a
portable, local-first context layer so your facts, preferences, chat history,
and project state live in **one store you own**, and every tool you trust
gets exactly the slice you grant it.

- **You own the data.** One SQLite file on your machine. Back it up, encrypt
  it with SQLCipher, move it between laptops.
- **Per-tool scopes.** Each connected client gets its own bearer token and
  explicit `(scope, read, write)` grants. A revoked tool can't read anything.
- **Multi-modal recall.** Hybrid semantic + keyword search over memories,
  document chunks, imported conversations, and workspace items.
- **Open surface.** Standard MCP — any compliant client works without custom
  integrations.

## Features

| Area            | What you get |
|-----------------|--------------|
| Memories        | Atomic facts with tags, kind, source; semantic + FTS fallback |
| Documents       | Ingest files, chunk + embed, query by chunk |
| History         | Import ChatGPT, Claude, Gemini Takeout, or generic JSON |
| Workspaces      | Track active project, goals, tasks, threads |
| Access control  | Per-tool bearer tokens, sha256-hashed, constant-time compare |
| Transports      | MCP over stdio **or** Streamable HTTP |
| Embeddings      | Pluggable: stub (dev), Ollama, ONNX via `@xenova/transformers` |
| Storage         | SQLite + `sqlite-vec` (vector) + FTS5 (lexical), optional SQLCipher |
| Audit           | Every MCP call logged with redacted args and outcome |
| CLI             | `dcx` for init, tool/scope admin, ingest, import, backup, audit |
| Evals           | Retrieval recall@k and adversarial scope-isolation suites |

## Quickstart

Requires **Node 20+**.

> **Tip:** `npm link` (or `npm install -g .`) after `npm run build` puts
> `dcx` on your `$PATH`. The examples below use `node dist/cli/index.js`
> so they work before linking; you can substitute `dcx` once the CLI is
> installed globally.

```bash
git clone https://github.com/robertclapp/darkcontext.git
cd darkcontext
npm install
npm run build

# Initialize the store at ~/.darkcontext/store.db
node dist/cli/index.js init

# Remember and recall (stub embeddings by default)
node dist/cli/index.js remember "Espresso machine descales every 60 shots" --tags coffee
node dist/cli/index.js recall "how often do I descale"

# Ingest a document
node dist/cli/index.js ingest ./README.md --scope work
node dist/cli/index.js document search "quickstart" --scope work

# Import prior conversations
node dist/cli/index.js import chatgpt path/to/conversations.json --scope personal
node dist/cli/index.js history search "espresso"

# Provision a tool + serve MCP
node dist/cli/index.js tool add claude-desktop --scopes personal,work
node dist/cli/index.js serve                     # stdio
node dist/cli/index.js serve --http --port 4000  # HTTP + Bearer auth
```

### Using Ollama for real semantic embeddings

```bash
export DARKCONTEXT_EMBEDDINGS=ollama
export OLLAMA_URL=http://localhost:11434
export OLLAMA_EMBED_MODEL=nomic-embed-text

# If you already have memories indexed with a different provider, rebuild:
node dist/cli/index.js reindex --provider ollama
```

## Connecting clients

### Claude Desktop / Claude Code (stdio)

`dcx tool add claude-desktop --scopes personal,work` prints a config snippet.
Drop it into Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "darkcontext": {
      "command": "dcx",
      "args": ["serve"],
      "env": { "DARKCONTEXT_TOKEN": "dcx_..." }
    }
  }
}
```

### HTTP-speaking clients

```bash
DARKCONTEXT_TOKEN=dcx_... dcx serve --http --port 4000
```

Clients POST JSON-RPC to `http://127.0.0.1:4000/mcp` with
`Authorization: Bearer dcx_...` and
`Accept: application/json, text/event-stream`. See
[`docs/MCP_TOOLS.md`](docs/MCP_TOOLS.md) for the full tool surface.

## Configuration

Every setting has an env var; call `dcx doctor` to sanity-check them.

| Variable                         | Default                      | Purpose                                  |
|----------------------------------|------------------------------|------------------------------------------|
| `DARKCONTEXT_HOME`               | `~/.darkcontext`             | Data directory                           |
| `DARKCONTEXT_DB_PATH`            | `$DARKCONTEXT_HOME/store.db` | Override DB path                         |
| `DARKCONTEXT_TOKEN`              | —                            | Bearer token for stdio / HTTP            |
| `DARKCONTEXT_EMBEDDINGS`         | `stub`                       | `stub` \| `ollama` \| `onnx`             |
| `DARKCONTEXT_ENCRYPTION_KEY`     | —                            | Enables SQLCipher at rest (see docs)     |
| `OLLAMA_URL`                     | `http://localhost:11434`     | Ollama server                            |
| `OLLAMA_EMBED_MODEL`             | `nomic-embed-text`           | Embedding model                          |
| `DARKCONTEXT_ONNX_MODEL`         | `Xenova/all-MiniLM-L6-v2`    | ONNX embedding model                     |

## Development

```bash
npm run typecheck   # src + tests + evals
npm run lint
npm test            # unit + integration suites
npm run eval        # retrieval + scope-isolation evals
npm run build
```

Before opening a PR make sure `typecheck`, `lint`, `test`, and `build` are
green — CI runs all four on every push.

## Project layout

```
src/
├── core/
│   ├── context.ts       AppContext DI container
│   ├── config.ts        env + override resolver
│   ├── constants.ts     named tunables
│   ├── errors.ts        DarkContextError hierarchy
│   ├── store/           SQLite + sqlite-vec + FTS5 glue
│   ├── memories/ documents/ conversations/ workspace/
│   ├── tools/ scopes/   identity + access control
│   ├── audit/           redacted MCP call log
│   ├── embeddings/      stub | ollama | onnx
│   └── importers/       chatgpt | claude | gemini | generic
├── mcp/
│   ├── scopeFilter.ts   security boundary
│   ├── server.ts httpServer.ts  transports
│   └── tools/           one file per MCP tool + registry.ts
├── cli/                 `dcx` command surface
└── index.ts             public API

evals/
├── retrieval/           recall@k across embedding providers
└── scope-isolation/     adversarial cross-scope attacks

tests/
├── unit/                domain + security + tooling suites
└── integration/         MCP + HTTP + backup
```

## Documentation

- [`docs/DARKCONTEXT_PLAN.md`](docs/DARKCONTEXT_PLAN.md) — product plan and phased delivery
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — layers, data model, extension points
- [`docs/MCP_TOOLS.md`](docs/MCP_TOOLS.md) — tool-by-tool MCP surface
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model, tokens, encryption, audit

## Security

The security boundary is `src/mcp/scopeFilter.ts`. Every MCP call routes
through it; the raw domain modules are deliberately unscoped so the admin
CLI can operate on everything. Tokens are stored as sha256 hashes, compared
in constant time. Opt-in SQLCipher encrypts the store at rest.

Found a vulnerability? Please **do not file a public issue with reproduction
details**. See [`SECURITY.md`](SECURITY.md) for the disclosure process.

## Roadmap

- [x] M1 — Foundation: SQLite schema, embeddings, memories CRUD, `dcx init/remember/recall`
- [x] M2 — MCP surface: stdio, recall/remember/forget, tool/scope model, scope filter
- [x] M3 — Full context: documents, workspaces, HTTP + bearer auth
- [x] M4 — Importers: ChatGPT, Claude, Gemini Takeout, generic JSON
- [x] M5 — Hardening: audit log, backup/restore, SQLCipher opt-in
- [ ] M6 — Multi-user HTTP identity, hosted reference deployment
- [ ] M7 — First-party Cursor / ChatGPT adapter packages

## Contributing

Issues and PRs welcome. Please read [`CONTRIBUTING.md`](CONTRIBUTING.md)
first — it covers the dev loop, testing expectations, and the scope-filter
invariant every contributor needs to understand.

## License

[MIT](LICENSE) © Robert Clapp
