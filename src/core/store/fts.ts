import type Database from 'better-sqlite3';

/**
 * SQLite FTS5 helpers.
 *
 * FTS5 gives us real word-level lexical matching (tokenizer-aware,
 * punctuation-insensitive, multi-term queries with implicit AND) for when
 * vector search is unavailable or when the user wants exact-term matching.
 * We use contentless external-content tables configured by schema.sql, so
 * insert/update/delete triggers keep them in sync with the source tables.
 *
 * This module encapsulates:
 *   - "does FTS5 work on this build" detection (some minimal SQLite
 *     compilations omit FTS5),
 *   - turning an arbitrary user string into a safe `MATCH` expression
 *     that FTS5 won't parse as operators (quotes, asterisks, column
 *     filters, AND/OR/NOT keywords).
 *
 * Keep behavior changes here; callers just do `buildFtsQuery(raw)` and
 * pass the result to a prepared `MATCH ?` statement.
 */

let ftsAvailable: boolean | undefined;

/**
 * Detect FTS5 support once per process. `sqlite_compileoption_used` is the
 * canonical way to check. Cached because the answer is static for a given
 * build of better-sqlite3.
 */
export function isFtsAvailable(db: Database.Database): boolean {
  if (ftsAvailable !== undefined) return ftsAvailable;
  try {
    const row = db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS has").get() as
      | { has: number }
      | undefined;
    ftsAvailable = Boolean(row?.has);
  } catch {
    ftsAvailable = false;
  }
  return ftsAvailable;
}

/**
 * Turn an arbitrary user query into an FTS5 MATCH string that won't
 * accidentally trigger the FTS5 query-parser syntax. We:
 *   - split on whitespace (FTS5 uses its own tokenizer for the index; we
 *     just need a valid expression of terms),
 *   - strip every character that could be interpreted as syntax
 *     (`" * : ( ) ^ AND OR NOT NEAR`), as FTS5 otherwise will throw or
 *     match unexpectedly,
 *   - wrap each remaining token in double-quotes so it's treated as a
 *     phrase literal,
 *   - join with a space, which FTS5 reads as implicit AND.
 *
 * Empty input returns `''` — callers should treat that as "no keyword
 * search" rather than trying to execute it.
 */
export function buildFtsQuery(raw: string): string {
  const cleaned = raw
    .replace(/["*:()^]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !FTS_RESERVED.has(t.toUpperCase()));
  if (cleaned.length === 0) return '';
  return cleaned.map((t) => `"${t}"`).join(' ');
}

const FTS_RESERVED = new Set(['AND', 'OR', 'NOT', 'NEAR']);
