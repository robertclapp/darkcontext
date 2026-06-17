# Changelog

All notable changes to DarkContext will be documented here. Format
loosely follows [Keep a Changelog](https://keepachangelog.com/). Dates
are release dates; unreleased work lives at the top.

## [Unreleased]

### Fixed
- **Vector recall scope starvation.** `sqlite-vec` returns the globally
  nearest `k` vectors before any scope/source filter applies, so a dense
  neighbouring scope could crowd a caller's in-scope matches out of the
  candidate window — returning fewer results than exist, or none. Recall
  isolation was never violated (out-of-scope rows were always dropped);
  the bug was under-recall, not a leak. Vector search now uses adaptive
  widening (`store/vectorSearch.ts`): it pulls a growing nearest-neighbour
  window and filters in SQL until enough in-scope hits surface or the
  index is exhausted. A match buried at global rank 500+ is now recalled
  at limit 5 (see `npm run eval:skew`).

### Changed
- The access layer (`ScopeFilter`) now pushes a tool's readable-scope set
  into the domain query as a SQL `IN (…)` filter instead of over-fetching
  4× and filtering in JS. Filtering happens in one place (SQL), the magic
  over-fetch ratio is gone, and the empty readable set short-circuits to
  no results. Scope isolation is unchanged (verified by `eval:security`).
- Recall/search options accept an explicit `scopes` set (in addition to
  the single `scope`); the FTS5 and `LIKE` fallbacks honour it too.

## [0.2.0] — 2026-04-18

First polish pass after v0.1. Adds operational CLI commands, published
examples, coverage tooling, and release hygiene.

### Added
- `dcx show <id>` — inspect a single memory row including tags, scope, and timestamps.
- `dcx vacuum` — runs `PRAGMA integrity_check`, reports orphan vec rows, then `VACUUM`. Safe to run on a live store.
- `dcx doctor` now prints per-table row counts and the `integrity_check` result.
- `dcx tool add --json` — script-friendly output. Emits a single JSON object with `{ tool, token, grants, mcpServerConfig }` so launchers can pipe through `jq` instead of parsing the human banner. Shape is a public contract and tested.
- HTTP transport exposes `GET /healthz` (no auth) returning `{ ok: true, version, schemaVersion }` for uptime monitoring.
- `examples/` directory with paste-ready Claude Desktop config, a curl-driven HTTP demo script, an Ollama setup walkthrough, and a template generic-import dataset.
- `CONTRIBUTING.md` with dev loop, PR conventions, and extension guide.
- `LICENSE` (MIT; package.json previously claimed the license without the file).
- `npm run test:coverage` — v8 coverage via `@vitest/coverage-v8`.
- CI matrix now runs Node 20 and Node 22.

### Changed
- `README.md` now lists the new commands and links to `examples/`.
- `docs/MCP_TOOLS.md` minor refresh for the `/healthz` addition.

### Fixed
- None — 0.1.0 shipped with the architecture and correctness work caught during the merge review.

## [0.1.0] — 2026-04-18

Initial release. Implements the full plan in `docs/DARKCONTEXT_PLAN.md`
(M1–M5) plus 12 iterative design / quality / efficiency refactor passes.

### Added

**Storage**
- SQLite (`better-sqlite3`) + `sqlite-vec` for semantic search.
- FTS5 virtual tables on memories, document_chunks, messages — triggers keep the lexical index synced.
- `preparedCache` memoizes hot-path statements per connection.
- `schema_version` gate refuses stores written by a newer binary.
- Optional SQLCipher-at-rest (opt-in via `DARKCONTEXT_ENCRYPTION_KEY`).

**Domains**
- `Memories`, `Documents` (chunked), `Conversations` (imported), `Workspaces` — scope-aware CRUD with atomic `reindex` via `VectorIndex`.

**Access control**
- `Tools` + `Scopes` with sha256-hashed bearer tokens (`dcx_...` format, 43-char base64url body).
- `ScopeFilter` is the single security boundary — 18 unit tests + an 8-case adversarial eval prove cross-scope isolation.

**MCP surface (8 tools)**
- `remember`, `recall`, `forget`, `search_documents`, `search_history`, `list_workspaces`, `get_active_workspace`, `add_to_workspace`.
- Declared as data (`defineTool({...})` + `ALL_MCP_TOOLS` registry).
- Stdio + Streamable HTTP transports; HTTP uses constant-time bearer comparison with case-insensitive scheme parsing (RFC 7235).
- `withAudit` wraps every call; fail-closed args redaction.

**Importers**
- ChatGPT `conversations.json`, Claude export, Gemini Takeout (`MyActivity.json`), generic JSON.

**CLI**
- `dcx init | remember | recall | forget | list | document | workspace | history | import | tool | scope | backup | restore | audit | reindex | doctor | serve`.
- Sysexits-style exit codes: 64 / 66 / 77 / 78 / 1 / 2.
- Pure `runX(...)` functions per command for direct testing.

**Evals**
- `npm run eval` — retrieval quality (recall@k per provider) + 8-case adversarial scope isolation.

**Architecture**
- Single `AppContext` DI container owning DB + all domains; idempotent `close()`.
- `DarkContextError` hierarchy drives audit classification and CLI exit codes.
- Fail-closed audit redaction (every string over `AUDIT_REDACTION_LIMIT` summarized regardless of key name).
- Named constants module for every non-arbitrary tunable.
- FTS5 query sanitizer rejects operator-injection attempts.

### Security
- Tokens stored as sha256 hashes; plaintext returned once.
- HTTP bearer comparison via `crypto.timingSafeEqual`.
- `forget` + cross-scope reads return no-data rather than errors (no existence leak).
- Audit log redacts long strings fail-closed.

### Notes

The v0.1.0 release was preceded by 12 refactor passes and ~40
CodeRabbit / Codex review findings. Commit history on the original
branch documents each change individually.
