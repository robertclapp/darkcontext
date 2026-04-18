import type { Command } from 'commander';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { openDb } from '../../core/store/db.js';
import { loadConfig } from '../../core/config.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';

export function registerBackup(program: Command): void {
  program
    .command('backup <dest>')
    .description('Snapshot the DarkContext store to <dest> (online, via SQLite backup API)')
    .option('--db <path>', 'override source database path')
    .action(async (dest: string, opts: { db?: string }) => {
      const destPath = resolve(dest);
      mkdirSync(dirname(destPath), { recursive: true });
      // Open the source through the same config resolver every other
      // command uses so SQLCipher-encrypted stores can be backed up — the
      // key comes from DARKCONTEXT_ENCRYPTION_KEY. Previously this call
      // passed only `path`, so encrypted deployments could not run
      // `dcx backup` at all.
      const cfg = loadConfig(opts.db ? { dbPath: opts.db } : {});
      const src = openDb({
        path: cfg.dbPath,
        ...(cfg.encryptionKey ? { encryptionKey: cfg.encryptionKey } : {}),
      });
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
      if (!existsSync(srcPath)) throw new NotFoundError('backup file', srcPath);
      const destPath = opts.db ?? loadConfig().dbPath;

      if (!opts.yes) {
        throw new ValidationError(
          'yes',
          `refusing to overwrite ${destPath} without --yes. Inspect the backup first with \`dcx doctor --db ${srcPath}\`.`
        );
      }

      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(srcPath, destPath);
      for (const suffix of ['-wal', '-shm']) {
        const from = `${srcPath}${suffix}`;
        const to = `${destPath}${suffix}`;
        if (existsSync(from)) copyFileSync(from, to);
      }
      console.log(`restored ${destPath} from ${srcPath}`);
    });
}
