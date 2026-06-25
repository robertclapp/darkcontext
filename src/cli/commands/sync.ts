import type { Command } from 'commander';
import { resolve } from 'node:path';

import { loadConfig } from '../../core/config.js';
import { pull as pullStore, push as pushStore } from '../../core/sync/index.js';

export interface PushOptions {
  db?: string;
  force?: boolean;
}

export interface PullOptions {
  db?: string;
  yes?: boolean;
  force?: boolean;
}

export async function runPush(
  dest: string,
  opts: PushOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  const cfg = loadConfig(opts.db ? { dbPath: opts.db } : {});
  const result = await pushStore({
    source: cfg.dbPath,
    dest: resolve(dest),
    ...(cfg.encryptionKey ? { encryptionKey: cfg.encryptionKey } : {}),
    ...(opts.force ? { force: true } : {}),
  });
  const broke = result.lockBroken ? ' (broke stale lock)' : '';
  out(`pushed ${result.bytes} bytes -> ${result.dest}${broke}`);
}

export async function runPull(
  src: string,
  opts: PullOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  const cfg = loadConfig(opts.db ? { dbPath: opts.db } : {});
  const result = await pullStore({
    source: resolve(src),
    dest: cfg.dbPath,
    ...(cfg.encryptionKey ? { encryptionKey: cfg.encryptionKey } : {}),
    ...(opts.force ? { force: true } : {}),
    allowOverwrite: opts.yes === true,
  });
  const broke = result.lockBroken ? ' (broke stale lock)' : '';
  out(`pulled ${result.bytes} bytes <- ${result.source} -> ${result.dest}${broke}`);
}

export function registerSync(program: Command): void {
  program
    .command('push <dest>')
    .description(
      'Atomically copy the local store to <dest> (any reachable path: NFS mount, Syncthing/Dropbox folder, etc.). Single-writer-at-a-time; uses a lock file at <dest>.lock to prevent concurrent corruption.'
    )
    .option('--db <path>', 'override source database path')
    .option('--force', 'override an existing lock file (use only if you know the recorded process is dead)', false)
    .action(async (dest: string, opts: PushOptions) => {
      await runPush(dest, opts);
    });

  program
    .command('pull <src>')
    .description(
      'Atomically copy a remote store at <src> into the local store (overwrites with --yes). Locks <src>.lock during the read.'
    )
    .option('--db <path>', 'override destination database path')
    .option('--yes', 'confirm overwriting an existing local store', false)
    .option('--force', 'override an existing lock file on <src>', false)
    .action(async (src: string, opts: PullOptions) => {
      await runPull(src, opts);
    });
}
