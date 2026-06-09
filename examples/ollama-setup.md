# Using Ollama for real semantic embeddings

The default `stub` provider is deterministic and has zero setup cost,
but its vectors are hash-derived and only lightly semantic. For real
retrieval quality, point DarkContext at a local Ollama server.

## 1. Install + start Ollama

Mac:

```bash
brew install ollama
ollama serve &
```

Linux:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama serve &
```

## 2. Pull an embedding model

```bash
ollama pull nomic-embed-text
```

`nomic-embed-text` produces 768-dim vectors and is the default DarkContext expects.
Alternatives: `mxbai-embed-large` (1024-dim), `snowflake-arctic-embed` (1024-dim). If
you pick a different model, export `OLLAMA_EMBED_MODEL=<name>`.

## 3. Point DarkContext at it

Either via env vars (session-wide):

```bash
export DARKCONTEXT_EMBEDDINGS=ollama
export OLLAMA_URL=http://localhost:11434   # default
export OLLAMA_EMBED_MODEL=nomic-embed-text # default
```

Or per-command:

```bash
dcx remember "…" --provider ollama
```

## 4. If you already have a stub-indexed store, rebuild

Swapping providers with different vector dimensions is a breaking
change for the on-disk index. Fix it with one command:

```bash
dcx reindex --provider ollama
```

This truncates every vec table, re-embeds every memory / document
chunk / message through the new provider, and bulk-inserts inside a
single transaction. If the new provider fails mid-way, the old index
is preserved (see `VectorIndex.reindex` for the atomicity contract).

## 5. Verify

```bash
dcx doctor --provider ollama
```

Should report `embed dim (stored): 768` (or whatever your model produces)
and `embed sample: ok`. Run the retrieval eval to confirm quality:

```bash
DARKCONTEXT_EMBEDDINGS=ollama npm run eval:retrieval
```

Recall@5 should be noticeably higher than the stub baseline
(which clears 80%).
