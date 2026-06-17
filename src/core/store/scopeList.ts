/**
 * Recall/search accept scope filtering in two forms:
 *   - `scope`  — a single scope name (CLI `--scope`, ergonomic).
 *   - `scopes` — an explicit set (the access layer pushes a tool's full
 *     readable-scope set down so filtering happens in SQL, not after).
 *
 * This normalizes the two into one optional list with a clear tri-state:
 *   - `undefined`     → no scope filter (return matches from any scope)
 *   - `[]` (empty)    → filter that matches nothing (caller has no
 *                       readable scopes) — callers MUST short-circuit
 *   - `[a, b, …]`     → restrict to these scopes
 *
 * `scopes` wins over `scope` when both are present.
 */
export function normalizeScopeList(opts: {
  scope?: string;
  scopes?: readonly string[];
}): readonly string[] | undefined {
  if (opts.scopes !== undefined) return opts.scopes;
  if (opts.scope !== undefined) return [opts.scope];
  return undefined;
}
