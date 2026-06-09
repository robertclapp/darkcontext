/**
 * One place for the tunables that used to be magic numbers scattered across
 * the codebase. Grouped by concern; each export has a short rationale so a
 * future reader knows whether a value is load-bearing or arbitrary.
 */

/** Released binary version. Kept in lockstep with `package.json :: version`.
 *  Surfaced by `commander.version()` and `/healthz` so a single bump covers
 *  every user-visible place the version appears. */
export const VERSION = '0.2.0';

/** Schema version currently understood by this binary. Bump when you add a
 *  non-additive change to `schema.sql` so older dcx versions fail loudly. */
export const SCHEMA_VERSION = 3;

/** Name of the scope seeded by schema.sql. Used wherever a memory /
 *  document / workspace is created without an explicit scope. Renaming
 *  this is a breaking change — every existing store's `scopes` row and
 *  `memories.scope_id` FK would dangle. */
export const DEFAULT_SCOPE_NAME = 'default';

/** Default memory kind when caller doesn't specify one. Matches the SQL
 *  DEFAULT on `memories.kind` in schema.sql. */
export const DEFAULT_MEMORY_KIND = 'fact';

/** Default workspace-item state when caller doesn't specify one. Matches
 *  the SQL DEFAULT on `workspace_items.state` in schema.sql. */
export const DEFAULT_WORKSPACE_ITEM_STATE = 'open';

/** Deterministic stub embedding dimension. 128 is big enough to give the
 *  VectorIndex tests meaningful variance without bloating CI. Picked when
 *  first writing the stub; no downstream code depends on this specific
 *  value. Changing it only affects stub-backed stores. */
export const STUB_EMBED_DIM = 128;

/** Default document-chunk character budget. ~300 tokens at English density
 *  — fits comfortably inside every embedding model's context window and
 *  leaves headroom for prefixes. */
export const DEFAULT_CHUNK_SIZE = 1200;

/** Default chunk overlap. ~12% of chunk size, enough to preserve one
 *  sentence of continuity without wasting embedding budget. */
export const DEFAULT_CHUNK_OVERLAP = 150;

/** When scope-filtering recall hits, how many raw results to fetch per
 *  requested hit so filtering still returns a full page in the common case.
 *  Higher = better recall when the query crosses scopes; costs O(k) at
 *  query time. */
export const RECALL_OVERFETCH_RATIO = 4;

/** Audit log: strings longer than this are redacted to a summary. Chosen to
 *  preserve enums / short labels (scope names, kinds, ids-as-strings) while
 *  hiding any field that could be a memory / document body. */
export const AUDIT_REDACTION_LIMIT = 40;

/** Audit log: characters of prefix + suffix kept around a summarized field
 *  so operators can tell redacted strings apart in the log. */
export const AUDIT_REDACTION_CONTEXT = 16;

/** MCP HTTP transport: default bind host. Localhost by design — exposing
 *  DarkContext publicly requires explicit intent (TLS + --host). */
export const DEFAULT_HTTP_HOST = '127.0.0.1';

/** MCP HTTP transport: default port. */
export const DEFAULT_HTTP_PORT = 4000;
