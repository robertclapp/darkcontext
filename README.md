# DarkContext

Bring-your-own-context for LLMs. Store memories, documents, conversation history, and workspace state once — expose it to any LLM tool (Claude Desktop, Cursor, ChatGPT, Gemini) under per-tool scopes you control.

See [`docs/DARKCONTEXT_PLAN.md`](docs/DARKCONTEXT_PLAN.md) for the full architecture and phased delivery plan.

## Status

**M1 (Foundation) in progress** — CLI + SQLite store + embedding providers. MCP server lands in M2.

## Quickstart

```bash
npm install
npm run build

# initialize store at ~/.darkcontext/store.db
node dist/cli/index.js init

# store + recall a memory (uses stub embeddings by default)
node dist/cli/index.js remember "Espresso machine descales every 60 shots" --tags coffee
node dist/cli/index.js recall "how often do I descale"
```

To use Ollama embeddings instead of the stub provider, set:

```bash
export DARKCONTEXT_EMBEDDINGS=ollama
export OLLAMA_URL=http://localhost:11434
export OLLAMA_EMBED_MODEL=nomic-embed-text
```

## Tests

```bash
npm test
npm run typecheck
npm run lint
```
