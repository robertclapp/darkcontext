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
import { runExport } from '../../src/cli/commands/export.js';

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

  it('runExport writes a snapshot file and prints a summary', async () => {
    const { readFileSync } = await import('node:fs');
    await runRemember('fact', { db: dbPath, kind: 'fact' });
    const out = join(dir, 'snap.json');
    const cap = capture();
    await runExport({ db: dbPath, out, pretty: true }, cap.write);
    expect(cap.lines[0]).toMatch(/^export ok: .+snap\.json \(memories=1, documents=0/);
    const parsed = JSON.parse(readFileSync(out, 'utf8'));
    expect(parsed.memories).toHaveLength(1);
    expect(parsed.memories[0].content).toBe('fact');
  });
});
