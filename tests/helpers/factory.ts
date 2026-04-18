import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { openDb, type DarkContextDb } from '../../src/core/store/db.js';
import { Memories } from '../../src/core/memories/index.js';
import { Documents } from '../../src/core/documents/index.js';
import { Workspaces } from '../../src/core/workspace/index.js';
import { Tools } from '../../src/core/tools/index.js';
import { StubEmbeddingProvider } from '../../src/core/embeddings/stub.js';

export interface Fixture {
  dir: string;
  db: DarkContextDb;
  memories: Memories;
  documents: Documents;
  workspaces: Workspaces;
  tools: Tools;
  cleanup: () => void;
}

export function makeFixture(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'dcx-test-'));
  const db = openDb({ path: join(dir, 'store.db') });
  const embeddings = new StubEmbeddingProvider(64);
  const memories = new Memories(db, embeddings);
  const documents = new Documents(db, embeddings);
  const workspaces = new Workspaces(db);
  const tools = new Tools(db);
  return {
    dir,
    db,
    memories,
    documents,
    workspaces,
    tools,
    cleanup: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
