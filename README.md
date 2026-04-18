# DarkContext

Bring-your-own-context for LLMs. Store memories, documents, conversation
history, and workspace state once — expose it to any LLM tool (Claude
Desktop, Cursor, ChatGPT, Gemini) under per-tool scopes you control.

See [`docs/DARKCONTEXT_PLAN.md`](docs/DARKCONTEXT_PLAN.md) for the
architecture and phased delivery plan,
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the current layout,
[`docs/SECURITY.md`](docs/SECURITY.md) for the threat model, and
[`docs/MCP_TOOLS.md`](docs/MCP_TOOLS.md) for the MCP surface.

## Quickstart

```bash
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

## Development

```bash
npm run typecheck   # src + tests + evals
npm run lint
npm test            # 131 tests across 23 suites
npm run eval        # retrieval + scope-isolation evals
npm run build
```

### Project layout

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
├── unit/                ~20 suites
└── integration/         MCP + HTTP + backup
```

## License

MIT.
