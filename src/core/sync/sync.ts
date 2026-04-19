import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';

import { openDb } from '../store/db.js';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../errors.js';

/**
 * File-level sync between a local store and a "remote" path that is
 * actually any reachable filesystem location — Syncthing folder, NFS
 * mount, mounted Dropbox/iCloud Drive directory. The user brings their
 * own transport; we just provide safe push/pull semantics.
 *
 * **Single-writer-at-a-time.** The lock file (`<remote>.lock`) prevents
 * two `dcx push` runs from corrupting the destination, but it does NOT
 * give you concurrent multi-writer safety. If two laptops edit the
 * shared store between sync runs, the later push wins; the earlier
 * laptop's changes are lost. Multi-writer merge is a different feature
 * with a different shape (CRDT, server arbitration) and is explicitly
 * out of scope here.
 *
 * The atomicity story: push writes to `<dest>.tmp` first via SQLite's
 * online backup API, then `rename()` to `<dest>` so a crashed push
 * never leaves a half-written DB at the destination. The lock file
 * carries `{host, pid, ts, op}` so an operator can see who's holding
 * it and decide to break it with `--force`.
 */

const LOCK_TTL_MS = 5 * 60_000;
const TMP_SUFFIX = '.dcx-tmp';
const LOCK_SUFFIX = '.lock';

export interface SyncOptions {
  /**
   * Source path. For `push`, this is the local store. For `pull`, this
   * is the remote path. Required.
   */
  source: string;
  /**
   * Destination path. For `push`, this is the remote path. For `pull`,
   * this is the local store. Required.
   */
  dest: string;
  /**
   * SQLCipher key passed through to `openDb`. Only relevant for the
   * source side: SQLite's backup API writes the destination as a plain
   * blob, which preserves encrypted-at-rest state when both sides use
   * the same key.
   */
  encryptionKey?: string;
  /**
   * Override an existing lock file even if it's fresh. Use when you're
   * sure the recorded process is dead (laptop crashed, etc.).
   */
  force?: boolean;
  /** Override "now" for deterministic tests. Defaults to Date.now(). */
  now?: number;
}

export interface SyncResult {
  /** Bytes written to the destination. */
  bytes: number;
  /** Resolved absolute paths used. */
  source: string;
  dest: string;
  /** Whether a stale lock had to be broken. */
  lockBroken: boolean;
}

interface LockBody {
  host: string;
  pid: number;
  ts: number;
  op: 'push' | 'pull';
}

/**
 * Push the local store to a remote path. Uses SQLite's online backup API
 * so the source store can stay open elsewhere. The destination is
 * written atomically: backup → fsync (implicit via SQLite) → rename.
 */
export async function push(opts: SyncOptions, now: number = opts.now ?? Date.now()): Promise<SyncResult> {
  const sourcePath = resolveOrThrow(opts.source, 'source');
  const destPath = resolve(opts.dest);

  if (!existsSync(sourcePath)) {
    throw new NotFoundError('local store', sourcePath);
  }

  mkdirSync(dirname(destPath), { recursive: true });

  const lockBroken = acquireLock(destPath, 'push', now, opts.force === true);
  try {
    const tmpPath = `${destPath}${TMP_SUFFIX}`;
    cleanupTmp(tmpPath);

    const src = openDb({
      path: sourcePath,
      ...(opts.encryptionKey ? { encryptionKey: opts.encryptionKey } : {}),
    });
    try {
      await src.raw.backup(tmpPath);
    } finally {
      src.close();
    }

    // Atomic publish: rename only succeeds when the temp file is fully
    // written. A crashed push leaves the .tmp behind for the next run to
    // sweep but never partially overwrites the destination.
    renameSync(tmpPath, destPath);

    return { source: sourcePath, dest: destPath, bytes: statSync(destPath).size, lockBroken };
  } finally {
    // Release the lock whether the copy succeeded or blew up mid-way.
    // If we crashed before the rename, the .tmp is still sitting next
    // to the old destination and the next push will overwrite it; the
    // destination itself is unchanged. Either way, leaving the lock
    // behind would force the next operator to pass --force, which is
    // worse than cleaning it up.
    releaseLock(destPath);
  }
}

/**
 * Pull a remote path into the local store. Same atomic strategy as
 * push, but the source is the remote and the dest is local — operators
 * who already have a working store at the destination MUST pass
 * `force: true` to confirm the overwrite (mirrors `dcx restore --yes`).
 */
export async function pull(
  opts: SyncOptions & { allowOverwrite?: boolean },
  now: number = opts.now ?? Date.now()
): Promise<SyncResult> {
  const sourcePath = resolveOrThrow(opts.source, 'source');
  const destPath = resolve(opts.dest);

  if (!existsSync(sourcePath)) {
    throw new NotFoundError('remote store', sourcePath);
  }
  if (existsSync(destPath) && opts.allowOverwrite !== true) {
    throw new ValidationError(
      'allowOverwrite',
      `local store already exists at ${destPath} — pass --yes to overwrite`
    );
  }

  mkdirSync(dirname(destPath), { recursive: true });

  // Lock the SOURCE during pull — that's the file we're reading from.
  // A concurrent push to the same remote would corrupt the read.
  const lockBroken = acquireLock(sourcePath, 'pull', now, opts.force === true);
  try {
    const tmpPath = `${destPath}${TMP_SUFFIX}`;
    cleanupTmp(tmpPath);

    const remote = openDb({
      path: sourcePath,
      ...(opts.encryptionKey ? { encryptionKey: opts.encryptionKey } : {}),
    });
    try {
      await remote.raw.backup(tmpPath);
    } finally {
      remote.close();
    }
    renameSync(tmpPath, destPath);

    return { source: sourcePath, dest: destPath, bytes: statSync(destPath).size, lockBroken };
  } finally {
    releaseLock(sourcePath);
  }
}

// ---------- internals ----------

function lockPath(p: string): string {
  return `${p}${LOCK_SUFFIX}`;
}

/**
 * Acquire `<path>.lock`. Returns true when a stale lock was overridden,
 * false when no prior lock existed. Throws ConflictError when a fresh
 * lock is held and `force` is not set.
 *
 * "Fresh" means the lock's recorded `ts` is within LOCK_TTL_MS of `now`.
 * We don't try to verify the recorded pid is still alive — across hosts
 * that's not even meaningful — so the TTL is the only liveness signal.
 */
function acquireLock(path: string, op: 'push' | 'pull', now: number, force: boolean): boolean {
  const lp = lockPath(path);
  let broken = false;
  if (existsSync(lp)) {
    const existing = readLock(lp);
    const stale = existing === null || now - existing.ts > LOCK_TTL_MS;
    if (!stale && !force) {
      throw new ConflictError(
        'sync lock',
        `${lp} held by ${existing!.host}:${existing!.pid} since ${new Date(existing!.ts).toISOString()} — pass --force to break`
      );
    }
    rmSync(lp, { force: true });
    // Surface only the *stale* lock breaks — a --force break is the
    // operator's explicit choice and doesn't need to be echoed back.
    broken = stale;
  }
  const body: LockBody = { host: hostname(), pid: process.pid, ts: now, op };
  writeFileSync(lp, JSON.stringify(body), { encoding: 'utf8', flag: 'wx' });
  return broken;
}

function releaseLock(path: string): void {
  rmSync(lockPath(path), { force: true });
}

function readLock(p: string): LockBody | null {
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<LockBody>;
    if (
      typeof parsed.host !== 'string' ||
      typeof parsed.pid !== 'number' ||
      typeof parsed.ts !== 'number' ||
      (parsed.op !== 'push' && parsed.op !== 'pull')
    ) {
      return null;
    }
    return parsed as LockBody;
  } catch {
    return null;
  }
}

function cleanupTmp(p: string): void {
  if (existsSync(p)) rmSync(p, { force: true });
}

function resolveOrThrow(p: string, label: string): string {
  if (!p || !p.trim()) throw new ValidationError(label, `${label} path is required`);
  return resolve(p);
}
