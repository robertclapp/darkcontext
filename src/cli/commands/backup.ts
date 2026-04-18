import type { Command } from 'commander';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { openDb } from '../../core/store/db.js';
import { defaultDbPath } from '../../core/store/paths.js';

export function registerBackup(program: Command): void {
  program
    .command('backup <dest>')
    .description('Snapshot the DarkContext store to <dest> (online, via SQLite backup API)')
    .option('--db <path>', 'override source database path')
    .action(async (dest: string, opts: { db?: string }) => {
      const destPath = resolve(dest);
      mkdirSync(dirname(destPath), { recursive: true });
      const src = openDb(opts.db ? { path: opts.db } : {});
      try {
        await src.raw.backup(destPath);
        const bytes = statSync(destPath).size;
        console.log(`backup ok: ${destPath} (${bytes} bytes)`);
      } finally {
        src.close();
      }
    });

  program
    .command('restore <src>')
    .description('Replace the DarkContext store with a previously taken backup (DANGEROUS)')
    .option('--db <path>', 'override destination database path')
    .option('--yes', "don't prompt for confirmation", false)
    .action((src: string, opts: { db?: string; yes: boolean }) => {
      const srcPath = resolve(src);
      if (!existsSync(srcPath)) throw new Error(`no such backup file: ${srcPath}`);
      const destPath = opts.db ?? defaultDbPath();

      if (!opts.yes) {
        throw new Error(
          `refusing to overwrite ${destPath} without --yes. Inspect the backup first with \`dcx doctor --db ${srcPath}\`.`
        );
      }

      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(srcPath, destPath);
      // Also copy the WAL + SHM siblings if present, so we restore a
      // consistent snapshot. Absence is normal (backup API merges WAL in).
      for (const suffix of ['-wal', '-shm']) {
        const from = `${srcPath}${suffix}`;
        const to = `${destPath}${suffix}`;
        if (existsSync(from)) copyFileSync(from, to);
      }
      console.log(`restored ${destPath} from ${srcPath}`);
    });
}
