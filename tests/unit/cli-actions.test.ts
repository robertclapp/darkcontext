import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInit } from '../../src/cli/commands/init.js';
import { runRemember } from '../../src/cli/commands/remember.js';
import { runRecall } from '../../src/cli/commands/recall.js';
import { runForget } from '../../src/cli/commands/forget.js';
import { runList } from '../../src/cli/commands/list.js';
import { runReindex } from '../../src/cli/commands/reindex.js';
import { runPush, runPull } from '../../src/cli/commands/sync.js';

/**
 * CLI actions are pure functions. Each takes an output writer so tests can
 * capture stdout without spinning up a Commander program. This file locks in
 * the user-facing contract (output format + exit semantics) that the
 * interactive CLI delivers.
 */

function capture(): { lines: string[]; write: (l: string) => void } {
  const lines: string[] = [];
  return { lines, write: (l) => lines.push(l) };
}

describe('CLI actions (direct invocation)', () => {
  let dir: string;
  let dbPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dcx-cli-'));
    dbPath = join(dir, 'store.db');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('runInit prints store path, provider name, and vec status', async () => {
    const cap = capture();
    await runInit({ db: dbPath }, cap.write);
    const joined = cap.lines.join('\n');
    expect(joined).toContain('DarkContext store ready at:');
    expect(joined).toContain('embeddings provider: stub');
    expect(joined).toMatch(/sqlite-vec:\s+(loaded|unavailable)/);
  });

  it('runRemember writes a memory and echoes #id [scope] content', async () => {
    const cap = capture();
    await runRemember('hello world', { db: dbPath, kind: 'fact', tags: 'greeting' }, cap.write);
    expect(cap.lines[0]).toMatch(/^#\d+ \[default\] hello world$/);
    expect(cap.lines[1]).toBe('  tags: greeting');
  });

  it('runRecall returns (no matches) when the store is empty', async () => {
    const cap = capture();
    await runInit({ db: dbPath }, () => undefined);
    await runRecall('anything', { db: dbPath, limit: 5 }, cap.write);
    expect(cap.lines).toEqual(['(no matches)']);
  });

  it('runRecall surfaces the previously stored memory', async () => {
    await runRemember('descale espresso every 60 shots', { db: dbPath, kind: 'fact' }, () => undefined);
    const cap = capture();
    await runRecall('espresso descaling', { db: dbPath, limit: 3 }, cap.write);
    expect(cap.lines[0]).toMatch(/descale espresso/);
  });

  it('runForget reports success or a not-found message', async () => {
    await runRemember('will be forgotten', { db: dbPath, kind: 'fact' }, () => undefined);
    const capHit = capture();
    await runForget(1, { db: dbPath }, capHit.write);
    expect(capHit.lines[0]).toBe('forgot #1');

    const capMiss = capture();
    await runForget(9999, { db: dbPath }, capMiss.write);
    expect(capMiss.lines[0]).toBe('no memory with id 9999');
  });

  it('runList sorts newest first', async () => {
    await runRemember('first', { db: dbPath, kind: 'fact' }, () => undefined);
    await runRemember('second', { db: dbPath, kind: 'fact' }, () => undefined);
    const cap = capture();
    await runList({ db: dbPath, limit: 10 }, cap.write);
    expect(cap.lines[0]).toMatch(/^#\d+ \[default\] second$/);
    expect(cap.lines[1]).toMatch(/^#\d+ \[default\] first$/);
  });

  it('runReindex reports per-domain counts', async () => {
    await runRemember('alpha', { db: dbPath, kind: 'fact' }, () => undefined);
    const cap = capture();
    await runReindex({ db: dbPath }, cap.write);
    const joined = cap.lines.join('\n');
    expect(joined).toMatch(/memories: 1 rows/);
    expect(joined).toMatch(/document_chunks: 0 rows/);
    expect(joined).toMatch(/messages: 0 rows/);
  });

  it('runReindex --only memories skips the other domains', async () => {
    await runRemember('alpha', { db: dbPath, kind: 'fact' }, () => undefined);
    const cap = capture();
    await runReindex({ db: dbPath, only: 'memories' }, cap.write);
    const joined = cap.lines.join('\n');
    expect(joined).toContain('memories: 1 rows');
    expect(joined).not.toContain('document_chunks');
    expect(joined).not.toContain('messages');
  });

  it('runReindex rejects an unknown --only kind', async () => {
    await expect(
      runReindex({ db: dbPath, only: 'bogus' }, () => undefined)
    ).rejects.toThrow(/unknown kind/);
  });

  it('runIngest rejects chunk-overlap >= chunk-size', async () => {
    const { runIngest } = await import('../../src/cli/commands/ingest.js');
    const tmpFile = join(dir, 'sample.txt');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(tmpFile, 'hello world');
    await expect(
      runIngest(
        tmpFile,
        { db: dbPath, mime: 'text/plain', chunkSize: 100, chunkOverlap: 100 },
        () => undefined
      )
    ).rejects.toThrow(/smaller than chunk-size/);
  });

  it('runIngest prints a one-line summary on success', async () => {
    const { runIngest } = await import('../../src/cli/commands/ingest.js');
    const { writeFileSync } = await import('node:fs');
    const tmpFile = join(dir, 'ok.txt');
    writeFileSync(tmpFile, 'hello world — enough content to chunk');
    const cap = capture();
    await runIngest(
      tmpFile,
      { db: dbPath, mime: 'text/plain', chunkSize: 100, chunkOverlap: 10 },
      cap.write
    );
    // Shape: `#<id> [<scope>] <title> — <n> chunks`
    expect(cap.lines[0]).toMatch(/^#\d+ \[default\] ok\.txt — \d+ chunks$/);
  });

  it('runPush -> runPull round-trips through a remote path', async () => {
    await runRemember('round trip me', { db: dbPath, kind: 'fact' }, () => undefined);
    const remote = join(dir, 'remote', 'store.db');
    const cap = capture();
    await runPush(remote, { db: dbPath }, cap.write);
    expect(cap.lines[0]).toMatch(/^pushed \d+ bytes -> .+remote\/store\.db$/);

    // Pull into a fresh local path, verify content.
    const restored = join(dir, 'restored.db');
    const cap2 = capture();
    await runPull(remote, { db: restored }, cap2.write);
    expect(cap2.lines[0]).toMatch(/^pulled \d+ bytes <- .+remote\/store\.db -> .+restored\.db$/);

    const { AppContext } = await import('../../src/core/context.js');
    const ctx = AppContext.open({ dbPath: restored, embeddings: 'stub' });
    try {
      const list = ctx.memories.list();
      expect(list.some((m) => m.content === 'round trip me')).toBe(true);
    } finally {
      ctx.close();
    }
  });

  it('runPull refuses to overwrite an existing local store without --yes', async () => {
    // Seed the local store so push() has something to copy.
    await runRemember('seed', { db: dbPath, kind: 'fact' }, () => undefined);
    const remote = join(dir, 'remote', 'store.db');
    await runPush(remote, { db: dbPath }, () => undefined);
    // dbPath already exists; pull without --yes must fail.
    await expect(runPull(remote, { db: dbPath }, () => undefined)).rejects.toThrow(/--yes/);
  });
});
