import type Database from 'better-sqlite3';

import { RECALL_WIDEN_FACTOR } from '../constants.js';

import { VectorIndex } from './vectorIndex.js';
import { cached } from './preparedCache.js';

/**
 * The starvation problem this module exists to solve.
 *
 * `sqlite-vec`'s `vec0` virtual table answers `WHERE embedding MATCH ? AND
 * k = ?` by returning the `k` globally-nearest vectors by distance —
 * BEFORE any scope/source predicate on a joined table is applied. So a
 * naive `... AND k = limit AND s.name = ?` asks for the global top-`limit`
 * and only then filters by scope. If a dense neighbouring scope occupies
 * those `limit` slots, the caller's own in-scope matches never enter the
 * candidate window and recall silently returns fewer rows than exist — or
 * nothing at all. It never leaks the neighbour's data (the filter still
 * drops it); it starves you.
 *
 * The fix is adaptive widening: pull a window of nearest neighbours, apply
 * the real filter, and if too few survive AND the index isn't exhausted,
 * widen the window and try again. Bounded by the table's row count, so it
 * terminates and — at the limit — degenerates to a full scan that cannot
 * starve.
 */

export interface KnnCandidate {
  rowid: number;
  distance: number;
}

/** Raw global k-NN over a vec0 table: the `k` nearest rowids by distance,
 *  no joins or filters. Cacheable (fixed SQL shape per table). */
export function knnCandidates(
  db: Database.Database,
  vecTable: string,
  queryVector: number[],
  k: number
): KnnCandidate[] {
  const sql = `SELECT rowid, distance FROM ${vecTable} WHERE embedding MATCH ? AND k = ? ORDER BY distance`;
  return cached(db, sql).all(VectorIndex.queryBlob(queryVector), k) as KnnCandidate[];
}

function countVectorRows(db: Database.Database, vecTable: string): number {
  const row = db.prepare(`SELECT count(*) AS c FROM ${vecTable}`).get() as { c: number };
  return row.c;
}

/**
 * Max rowids passed to `hydrate` in one call. `hydrate` binds one SQL
 * host parameter per rowid (plus a few for scope/source); SQLite's
 * compile-time `SQLITE_MAX_VARIABLE_NUMBER` is 32766 on modern builds
 * but as low as 999 on legacy builds. We chunk well under the legacy
 * floor so adaptive widening to large `k` cannot trip the param limit.
 */
const HYDRATE_BATCH = 900;

/**
 * Run an adaptive-widening vector search.
 *
 * `hydrate` receives a slice of the current nearest-neighbour window
 * (ordered by distance) and must return ALL rows in that slice that
 * survive the caller's filter (scope, source, …). Slices are processed
 * in window order and their outputs concatenated; since the window is
 * already sorted ASC by distance and slices don't overlap, the merged
 * result stays globally distance-sorted. We keep widening `k` until
 * either `limit` survivors are found or the index is exhausted, then
 * return the top `limit`.
 *
 * The `count(*)` to find the widening ceiling is only issued when we
 * actually need to widen (first window came up short while full), so
 * the common no-filter / not-skewed case stays a single query.
 */
export function widenedVectorSearch<T>(params: {
  db: Database.Database;
  vecTable: string;
  queryVector: number[];
  limit: number;
  hydrate: (window: KnnCandidate[]) => T[];
}): T[] {
  const { db, vecTable, queryVector, limit, hydrate } = params;
  if (limit <= 0) return [];

  let k = limit;
  let total = -1; // resolved lazily, only if we must widen
  for (;;) {
    const window = knnCandidates(db, vecTable, queryVector, k);
    const survivors = hydrateChunked(window, limit, hydrate);
    if (survivors.length >= limit) return survivors.slice(0, limit);
    // Fewer candidates came back than we asked for ⇒ the index is
    // exhausted; this is every match there is.
    if (window.length < k) return survivors.slice(0, limit);
    if (total < 0) total = countVectorRows(db, vecTable);
    if (k >= total) return survivors.slice(0, limit);
    k = Math.min(k * RECALL_WIDEN_FACTOR, total);
  }
}

/** Drive `hydrate` over the window in HYDRATE_BATCH-sized slices. Stops
 *  early once survivors reach `limit` — chunk N has strictly greater
 *  distances than chunk N-1, so later chunks can only add ties or worse
 *  matches than what we already have. */
function hydrateChunked<T>(
  window: KnnCandidate[],
  limit: number,
  hydrate: (window: KnnCandidate[]) => T[]
): T[] {
  if (window.length <= HYDRATE_BATCH) return hydrate(window);
  const out: T[] = [];
  for (let i = 0; i < window.length; i += HYDRATE_BATCH) {
    out.push(...hydrate(window.slice(i, i + HYDRATE_BATCH)));
    if (out.length >= limit) return out;
  }
  return out;
}

/**
 * Build a ` AND <column> IN (?, ?, …)` fragment + bound params for a scope
 * (or any) set. Empty/undefined set yields no fragment — callers that mean
 * "no readable scopes ⇒ no results" must short-circuit before calling.
 */
export function inClause(
  column: string,
  values: readonly string[] | undefined
): { sql: string; params: string[] } {
  if (!values || values.length === 0) return { sql: '', params: [] };
  return {
    sql: ` AND ${column} IN (${values.map(() => '?').join(', ')})`,
    params: [...values],
  };
}
