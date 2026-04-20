import type { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';
import { exportSnapshot } from '../../core/export/index.js';
import { ValidationError } from '../../core/errors.js';

interface ExportOptions extends CommonCliOptions {
  out?: string;
  scope?: string;
  pretty?: boolean;
}

export async function runExport(
  opts: ExportOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  // Use explicit `!== undefined` so callers that pass `--scope ""` or
  // `--out ""` (e.g. from an unset shell var) are rejected rather than
  // silently treated as "no filter" / "print to stdout" — those
  // coercions can leak data the caller meant to keep scoped or
  // discard output they expected in a file.
  const scope = opts.scope !== undefined ? opts.scope.trim() : undefined;
  if (scope === '') {
    throw new ValidationError('scope', '--scope must be a non-empty string');
  }
  const outPath = opts.out !== undefined ? opts.out.trim() : undefined;
  if (outPath === '') {
    throw new ValidationError('out', '--out must be a non-empty path');
  }

  await withAppContext(opts, async (ctx) => {
    const snapshot = exportSnapshot(
      ctx.db,
      scope !== undefined ? { scope } : {}
    );
    const json = opts.pretty
      ? JSON.stringify(snapshot, null, 2)
      : JSON.stringify(snapshot);

    if (outPath !== undefined) {
      const destPath = resolve(outPath);
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
