import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';
import { resolveImporter, type ImporterKind } from '../../core/importers/index.js';

const SUBCOMMANDS: Array<{ kind: ImporterKind; alias?: string }> = [
  { kind: 'chatgpt' },
  { kind: 'claude' },
  { kind: 'gemini' },
  { kind: 'generic', alias: 'json' },
];

export function registerImport(program: Command): void {
  const imp = program
    .command('import')
    .description('Import conversation history from a supported exporter');

  for (const { kind, alias } of SUBCOMMANDS) {
    const cmd = imp.command(`${kind} <path>`).description(describe(kind));
    if (alias) cmd.aliases([alias]);
    cmd
      .option('--scope <scope>', 'scope to ingest into (created on demand)')
      .option('--db <path>', 'override database path')
      .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
      .action(async (path: string, opts: CommonCliOptions & { scope?: string }) => {
        const raw = readFileSync(resolve(path), 'utf8');
        const parsed = resolveImporter(kind).parse(raw);
        if (parsed.length === 0) {
          console.log('(no conversations parsed)');
          return;
        }
        await withAppContext(opts, async (ctx) => {
          const res = await ctx.conversations.ingest(kind, parsed, {
            ...(opts.scope ? { scope: opts.scope } : {}),
          });
          console.log(
            `imported: ${res.inserted} conversations, ${res.messages} messages (${res.skipped} skipped — already present)`
          );
        });
      });
  }
}

function describe(kind: ImporterKind): string {
  switch (kind) {
    case 'chatgpt': return 'Import ChatGPT `conversations.json` from a ChatGPT data export';
    case 'claude':  return 'Import Claude data export (JSON array of conversations with chat_messages)';
    case 'gemini':  return 'Import Gemini activity from Google Takeout (MyActivity.json)';
    case 'generic': return 'Import the generic DarkContext JSON shape (see docs). Alias: `json`.';
  }
}
