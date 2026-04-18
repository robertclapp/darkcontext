import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb } from '../../src/core/store/db.js';
import { Memories } from '../../src/core/memories/index.js';
import { StubEmbeddingProvider } from '../../src/core/embeddings/stub.js';

describe('backup / restore round-trip', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dcx-bk-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('snapshot via SQLite backup API produces an openable store with the same rows', async () => {
    const srcPath = join(dir, 'src.db');
    const dstPath = join(dir, 'backup.db');

    // Write some rows
    const src = openDb({ path: srcPath });
    const mem = new Memories(src, new StubEmbeddingProvider(64));
    await mem.remember({ content: 'alpha', scope: 'default', tags: ['one'] });
    await mem.remember({ content: 'beta', scope: 'default', tags: ['two'] });

    // Online backup while src is open (write transaction done).
    await src.raw.backup(dstPath);
    src.close();

    expect(statSync(dstPath).size).toBeGreaterThan(0);

    // Open the backup and confirm the rows are there.
    const restored = openDb({ path: dstPath });
    const rows = restored.raw.prepare('SELECT content FROM memories ORDER BY id').all() as { content: string }[];
    expect(rows.map((r) => r.content)).toEqual(['alpha', 'beta']);
    restored.close();
  });
});
