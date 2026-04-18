import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, type DarkContextDb } from '../../src/core/store/db.js';
import { Memories } from '../../src/core/memories/index.js';
import { Tools } from '../../src/core/tools/index.js';
import { StubEmbeddingProvider } from '../../src/core/embeddings/stub.js';

export interface Fixture {
  dir: string;
  db: DarkContextDb;
  memories: Memories;
  tools: Tools;
  cleanup: () => void;
}

export function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'dcx-test-'));
  const db = openDb({ path: join(dir, 'store.db') });
  const memories = new Memories(db, new StubEmbeddingProvider(64));
  const tools = new Tools(db);
  return {
    dir,
    db,
    memories,
    tools,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
