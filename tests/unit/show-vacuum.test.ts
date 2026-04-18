import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runRemember } from '../../src/cli/commands/remember.js';
import { runShow } from '../../src/cli/commands/show.js';
import { runVacuum } from '../../src/cli/commands/vacuum.js';
import { NotFoundError } from '../../src/core/errors.js';

function capture(): { lines: string[]; write: (l: string) => void } {
  const lines: string[] = [];
  return { lines, write: (l) => lines.push(l) };
}

describe('dcx show', () => {
  let dir: string;
  let dbPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dcx-show-'));
    dbPath = join(dir, 'store.db');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('prints a one-block view of an existing memory', async () => {
    await runRemember(
      'the turntable needs a new stylus',
      { db: dbPath, kind: 'fact', tags: 'audio,hardware', source: 'note-2025' },
      () => undefined
    );
    const cap = capture();
    await runShow(1, { db: dbPath }, cap.write);
    const text = cap.lines.join('\n');
    expect(cap.lines[0]).toBe('#1 [default] fact');
    expect(text).toContain('created:');
    expect(text).toContain('source:  note-2025');
    expect(text).toContain('tags:    audio, hardware');
    // Content is the last block, separated by a blank line.
    expect(cap.lines[cap.lines.length - 1]).toBe('the turntable needs a new stylus');
  });

  it('throws NotFoundError for an unknown id — bubbles up as exit 66', async () => {
    await expect(runShow(999, { db: dbPath }, () => undefined)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('dcx vacuum', () => {
  let dir: string;
  let dbPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dcx-vac-'));
    dbPath = join(dir, 'store.db');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('runs integrity_check, reports 0 orphans on a clean store, and VACUUMs', async () => {
    await runRemember('alpha', { db: dbPath, kind: 'fact' }, () => undefined);
    const cap = capture();
    await runVacuum({ db: dbPath }, cap.write);
    const text = cap.lines.join('\n');
    expect(text).toContain('integrity_check: ok');
    expect(text).toContain('orphan vec rows removed: 0');
    expect(text).toContain('VACUUM: ok');
  });

  it('reports + cleans orphan vec rows when they exist', async () => {
    await runRemember('alpha', { db: dbPath, kind: 'fact' }, () => undefined);

    // Manufacture an orphan by deleting the content row without its vector.
    const { openDb } = await import('../../src/core/store/db.js');
    const db = openDb({ path: dbPath });
    db.raw.exec('DELETE FROM memories'); // leaves memories_vec row behind
    const beforeOrphans = (
      db.raw
        .prepare('SELECT count(*) AS c FROM memories_vec WHERE rowid NOT IN (SELECT id FROM memories)')
        .get() as { c: number }
    ).c;
    db.close();
    expect(beforeOrphans).toBeGreaterThan(0);

    const cap = capture();
    await runVacuum({ db: dbPath }, cap.write);
    expect(cap.lines.join('\n')).toMatch(/orphan vec rows removed: [1-9]/);

    // Confirm the orphan is gone.
    const after = openDb({ path: dbPath });
    const afterCount = (
      after.raw
        .prepare('SELECT count(*) AS c FROM memories_vec WHERE rowid NOT IN (SELECT id FROM memories)')
        .get() as { c: number }
    ).c;
    after.close();
    expect(afterCount).toBe(0);
  });
});
