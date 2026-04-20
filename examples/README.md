# DarkContext examples

Paste-ready configs and end-to-end walkthroughs. Every file here is
intentionally self-contained — you should be able to follow one of
them without reading the rest of the repo.

| File | What it is |
|---|---|
| [`claude-desktop.json`](claude-desktop.json) | Drop-in block for Claude Desktop's `mcpServers` config. Uses stdio. |
| [`curl-http-demo.sh`](curl-http-demo.sh) | Full HTTP round-trip: spin up `dcx serve --http`, initialize an MCP session, list tools, call `remember`, call `recall`. Uses only `curl` + `jq`. |
| [`ollama-setup.md`](ollama-setup.md) | Installing Ollama locally, pulling `nomic-embed-text`, pointing DarkContext at it, and reindexing an existing store. |
| [`generic-import.json`](generic-import.json) | Template for the `dcx import generic` shape. Feed arbitrary LLM chat exports through it after pre-processing. |
