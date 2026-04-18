# DarkContext — Security

## Threat model

DarkContext holds private, user-authored context (memories, documents,
chat history, workspaces). The explicit threats in scope:

| # | Threat                                               | Mitigation                                                         |
|---|------------------------------------------------------|--------------------------------------------------------------------|
| 1 | A connected MCP tool reads another tool's scopes     | `ScopeFilter` enforces per-tool grants on every call (unit-tested) |
| 2 | A revoked MCP tool keeps using its old token         | Tokens are stored as sha256 hashes; `dcx tool revoke` drops the row|
| 3 | A rotated token is still valid                       | `dcx tool rotate` overwrites the hash; old token no longer matches |
| 4 | Bearer token sniffed over HTTP                       | Bind to `127.0.0.1` by default; run behind TLS for any remote use  |
| 5 | DB file stolen from disk                             | **Opt-in** SQLCipher encryption at rest (see below)                |
| 6 | An attacker with API access exfiltrates via `forget` | `forget` silently no-ops across scope boundaries — no existence leak |
| 7 | Tool call history is recoverable after the fact      | `audit_log` is queryable and prunable, args are redacted           |

Not in scope (yet): multi-user identity, per-request HTTP identity
(currently one process = one identity), hardened memory protections
against a compromised host, side-channels in the embedding provider.

## The security boundary — `ScopeFilter`

Every MCP call passes through `src/mcp/scopeFilter.ts`. It holds the
calling tool's grants (scope → can_read/can_write) and mediates access
to the underlying domain modules. Rules:

- **Writes** require `canWrite` on the target scope. Omitted-scope
  writes default to the tool's first writable scope; if none, deny.
- **Reads** with an explicit scope require `canRead` on that scope.
  Without an explicit scope, results are filtered to scopes the tool
  can read (over-fetch then trim to preserve limit semantics).
- **Deletes** behave like writes, but a cross-scope delete returns
  "not found" rather than "permission denied". This prevents an
  attacker from enumerating memory ids in scopes they cannot read.
- A tool with zero readable scopes receives an empty result, never an
  error (so it cannot distinguish "empty scope" from "no grants").

The raw domain APIs (`Memories`, `Documents`, `Workspaces`,
`Conversations`) are **deliberately unscoped**: that is how the admin
CLI operates. The MCP layer must never call them directly — it must go
through `ScopeFilter` or `withAudit(...)` of a filter method. This is a
single-file invariant; see `tests/unit/scopeFilter.test.ts` for the
exhaustive matrix.

## Tokens

- Format: `dcx_<43 base64url chars>` — 32 bytes of crypto randomness
  plus a `dcx_` prefix for quick visual ID.
- Storage: `sha256(token)` in `tools.token_hash`. The plaintext token
  is returned **once** by `dcx tool add` and never written to disk.
- Comparison: hash lookup is a primary-key index hit; HTTP bearer is
  also compared in constant time via `crypto.timingSafeEqual`.
- Lifecycle: rotate with `dcx tool rotate <name>`, revoke with
  `dcx tool revoke <name>`.

## Transport auth

- **stdio** — the MCP client (Claude Desktop / Cursor) spawns the
  server with `env.DARKCONTEXT_TOKEN` set. The server authenticates
  once at start-up; there is no per-request auth because stdio has no
  per-request identity.
- **HTTP** — `dcx serve --http --port 4000 --token $TOKEN` binds the
  process to a single token; every request must carry
  `Authorization: Bearer <token>`. Mismatches return `401` with
  `WWW-Authenticate: Bearer realm="darkcontext"`. Bind to localhost
  unless you have TLS and a reason.

## Audit log

- Every MCP call produces a row in `audit_log` with the calling tool
  id, mcp tool name, redacted args, outcome, and duration.
- Redaction: `content`, `text`, `query`, `body` string fields are
  replaced with `<Nc> first16… last16` so the log describes the call
  without becoming a shadow copy of the data. See
  `src/core/audit/audit.ts::CONTENT_KEYS`.
- `dcx audit list [--tool --outcome --limit]` prints recent activity.
- `dcx audit prune --before <iso>` drops rows older than the cutoff.

## Encryption at rest — SQLCipher opt-in

Stock `better-sqlite3` does **not** encrypt. If you want encryption:

1. Install a SQLCipher-linked SQLite (macOS Homebrew:
   `brew install sqlcipher`; Linux: your distro's `sqlcipher` package).
2. Rebuild `better-sqlite3` against it:
   ```
   npm rebuild better-sqlite3 --build-from-source \
     --with-sqlite=/path/to/sqlcipher/include
   ```
   Or swap to a binding that ships SQLCipher, e.g.
   `@journeyapps/sqlcipher`.
3. Set `DARKCONTEXT_ENCRYPTION_KEY` before running any `dcx` command.
4. Verify: `dcx doctor` should show `encryption: SQLCipher active`.
   If it shows "key set but SQLCipher not detected", your binding is
   not encrypting and silently persists plaintext — do not rely on it.

Keep the key in a password manager or OS keychain; losing it means the
database is unrecoverable.

## Backup / restore

- `dcx backup <dest>` uses SQLite's online backup API so you can snapshot
  a running store without stopping the server.
- `dcx restore <src> --yes` overwrites the destination. The command
  refuses without `--yes` because this is destructive.
- Encrypted stores carry their key over (the blob is encrypted on disk);
  you still need the same `DARKCONTEXT_ENCRYPTION_KEY` to open the
  restored copy.

## Reporting

Security issues: open a private issue on the repository. Do not file
public issues with reproduction details for denial-of-service or data
exfiltration paths until a fix has landed.
