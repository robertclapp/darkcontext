import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { openDb } from '../../core/store/db.js';
import { Conversations } from '../../core/conversations/index.js';
import { createEmbeddingProvider, resolveProviderKind } from '../../core/embeddings/index.js';
import { resolveImporter, type ImporterKind } from '../../core/importers/index.js';

export function registerImport(program: Command): void {
  const imp = program
    .command('import')
    .description('Import conversation history from a supported exporter');

  for (const kind of ['chatgpt', 'claude', 'gemini', 'json'] as ImporterKind[]) {
    imp
      .command(`${kind} <path>`)
      .description(describe(kind))
      .option('--scope <scope>', 'scope to ingest into (created on demand)')
      .option('--db <path>', 'override database path')
      .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
      .action(
        async (path: string, opts: { scope?: string; db?: string; provider?: string }) => {
          const raw = readFileSync(resolve(path), 'utf8');
          const parsed = resolveImporter(kind).parse(raw);
          if (parsed.length === 0) {
            console.log('(no conversations parsed)');
            return;
          }

          const db = openDb(opts.db ? { path: opts.db } : {});
          try {
            const conversations = new Conversations(
              db,
              createEmbeddingProvider(resolveProviderKind(opts.provider))
            );
            const res = await conversations.ingest(kind === 'json' ? 'generic' : kind, parsed, {
              ...(opts.scope ? { scope: opts.scope } : {}),
            });
            console.log(
              `imported: ${res.inserted} conversations, ${res.messages} messages (${res.skipped} skipped — already present)`
            );
          } finally {
            db.close();
          }
        }
      );
  }
}

function describe(kind: ImporterKind): string {
  switch (kind) {
    case 'chatgpt': return 'Import ChatGPT `conversations.json` from a ChatGPT data export';
    case 'claude':  return 'Import Claude data export (JSON array of conversations with chat_messages)';
    case 'gemini':  return 'Import Gemini activity from Google Takeout (MyActivity.json)';
    case 'json':    return 'Import the generic DarkContext JSON shape (see docs)';
  }
}
