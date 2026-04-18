import type { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';
import { exportSnapshot } from '../../core/export/index.js';

interface ExportOptions extends CommonCliOptions {
  out?: string;
  scope?: string;
  pretty?: boolean;
}

export async function runExport(
  opts: ExportOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  await withAppContext(opts, async (ctx) => {
    const snapshot = exportSnapshot(ctx.db, opts.scope ? { scope: opts.scope } : {});
    const json = opts.pretty
      ? JSON.stringify(snapshot, null, 2)
      : JSON.stringify(snapshot);

    if (opts.out) {
      const destPath = resolve(opts.out);
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, json + '\n', 'utf8');
      out(
        `export ok: ${destPath} ` +
          `(memories=${snapshot.memories.length}, ` +
          `documents=${snapshot.documents.length}, ` +
          `conversations=${snapshot.conversations.length}, ` +
          `workspaces=${snapshot.workspaces.length})`
      );
    } else {
      // No --out means "stream to stdout" for pipe-friendliness.
      // Use process.stdout.write to avoid console.log's trailing newline
      // duplicating the one we explicitly append below.
      process.stdout.write(json + '\n');
    }
  });
}

export function registerExport(program: Command): void {
  program
    .command('export')
    .description('Export the store to a canonical JSON snapshot (IDs stripped, embeddings omitted)')
    .option('-o, --out <path>', 'write to a file instead of stdout')
    .option('--scope <scope>', 'only export rows in this scope (default: all scopes)')
    .option('--pretty', 'pretty-print the JSON (2-space indent)', false)
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (opts: ExportOptions) => {
      await runExport(opts);
    });
}
