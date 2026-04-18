import type { Command } from 'commander';

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

    // Phase 1: integrity check.
    const integrityRows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const firstCheck = integrityRows[0]?.integrity_check ?? '';
    out(`integrity_check: ${firstCheck || '(no output)'}`);
    if (firstCheck !== 'ok') {
      throw new ConfigError(
        `integrity check failed — inspect the store before continuing. First result: ${firstCheck}`
      );
    }

    // Phase 2: orphan cleanup across the three vec tables.
    // A healthy store has zero orphans; we report whatever we find and
    // delete them so the next reindex starts clean.
    let orphans = 0;
    if (ctx.db.hasVec && ctx.db.embedDim > 0) {
      orphans += dropOrphans(db, 'memories_vec', 'memories');
      orphans += dropOrphans(db, 'document_chunks_vec', 'document_chunks');
      orphans += dropOrphans(db, 'messages_vec', 'messages');
    }
    out(`orphan vec rows removed: ${orphans}`);

    // Phase 3: VACUUM. Rewrites the file to reclaim space from deleted
    // rows. Safe to run on a live store; better-sqlite3 holds a single
    // connection so WAL checkpointing isn't an issue here.
    db.exec('VACUUM');
    out('VACUUM: ok');
  });
}

function dropOrphans(
  db: import('better-sqlite3').Database,
  vecTable: string,
  srcTable: string
): number {
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
