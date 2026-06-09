import type { Command } from 'commander';
import type Database from 'better-sqlite3';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';
import { ConfigError } from '../../core/errors.js';

/**
 * Maintenance command: integrity check, orphan cleanup, then VACUUM.
 *
 * Integrity first so a corrupt store surfaces BEFORE we touch it;
 * VACUUM last because it rewrites the entire file and would otherwise
 * hide the real damage in a clean copy. Orphan cleanup sits in the
 * middle: it's a no-op on a healthy store but rescues stores that
 * hit a failed transaction where vec rows were written without their
 * content-side row (or vice-versa).
 */
export async function runVacuum(
  opts: CommonCliOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  await withAppContext(opts, (ctx) => {
    const db = ctx.db.raw;

    // Phase 1: integrity check. PRAGMA integrity_check can return multiple
    // rows when the DB has multiple issues; show all of them so the user
    // sees the full picture before the store is further touched.
    const integrityRows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const messages = integrityRows.map((r) => r.integrity_check);
    const healthy = messages.length === 1 && messages[0] === 'ok';
    out(`integrity_check: ${healthy ? 'ok' : 'FAILED'}`);
    if (!healthy) {
      for (const m of messages) out(`  ${m}`);
      throw new ConfigError(
        `integrity check failed — inspect the store before continuing (${messages.length} issue${messages.length === 1 ? '' : 's'})`
      );
    }

    // Phase 2: orphan cleanup across the three vec tables. Skipped when
    // sqlite-vec is unavailable OR when no embeddings have ever been
    // written (embedDim === 0) — in both cases there are no vec tables
    // to scan. The status line distinguishes "clean" from "skipped" so
    // the user isn't misled into thinking we verified something we didn't.
    if (ctx.db.hasVec && ctx.db.embedDim > 0) {
      let orphans = 0;
      orphans += dropOrphans(db, 'memories_vec', 'memories');
      orphans += dropOrphans(db, 'document_chunks_vec', 'document_chunks');
      orphans += dropOrphans(db, 'messages_vec', 'messages');
      out(`orphan vec rows removed: ${orphans}`);
    } else {
      const reason = !ctx.db.hasVec ? 'sqlite-vec not loaded' : 'no vectors written yet';
      out(`orphan vec rows removed: 0 (skipped — ${reason})`);
    }

    // Phase 3: VACUUM. Rewrites the file to reclaim space from deleted
    // rows. Safe to run on a live store; better-sqlite3 holds a single
    // connection so WAL checkpointing isn't an issue here.
    db.exec('VACUUM');
    out('VACUUM: ok');
  });
}

// `vecTable` and `srcTable` are string-interpolated into SQL on purpose —
// they come from a closed set of literals in the caller above, not from
// user input. Keep it that way: never pass a user-supplied value here.
function dropOrphans(db: Database.Database, vecTable: string, srcTable: string): number {
  const res = db
    .prepare(
      `DELETE FROM ${vecTable}
       WHERE rowid NOT IN (SELECT id FROM ${srcTable})`
    )
    .run();
  return res.changes;
}

export function registerVacuum(program: Command): void {
  program
    .command('vacuum')
    .description('Integrity-check the store, drop orphan vec rows, then VACUUM to reclaim disk.')
    .option('--db <path>', 'override database path')
    .action(async (opts: CommonCliOptions) => {
      await runVacuum(opts);
    });
}
