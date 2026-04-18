import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';
import { SCHEMA_VERSION } from '../../core/constants.js';

function cipherStatus(hasCipher: boolean, keySet: boolean): string {
  if (hasCipher) return 'SQLCipher active';
  if (keySet) {
    return 'key set but SQLCipher not detected — stock better-sqlite3 does not encrypt. See docs/SECURITY.md.';
  }
  return 'disabled (set DARKCONTEXT_ENCRYPTION_KEY + a SQLCipher build to enable)';
}

/**
 * Per-table row counts reported by doctor. Static list so a future
 * table shows up explicitly rather than via a dynamic `sqlite_master`
 * scan (which would pull in vec / fts shadow tables).
 */
const COUNT_TABLES = [
  'memories',
  'documents',
  'document_chunks',
  'conversations',
  'messages',
  'workspaces',
  'workspace_items',
  'tools',
  'scopes',
  'audit_log',
] as const;

export async function runDoctor(
  opts: CommonCliOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  await withAppContext(opts, async (ctx) => {
    out(`db path:            ${ctx.config.dbPath}`);
    out(`schema version:     ${ctx.db.schemaVersion} (binary supports ${SCHEMA_VERSION})`);
    out(`sqlite-vec:         ${ctx.db.hasVec ? 'ok' : 'MISSING (falling back to keyword search)'}`);
    out(`encryption:         ${cipherStatus(ctx.db.hasCipher, !!ctx.config.encryptionKey)}`);
    out(`embed dim (stored): ${ctx.db.embedDim || '(none yet)'}`);
    out(`provider:           ${ctx.embeddings.name}`);

    // Integrity check — cheap on healthy stores, loud on damaged ones.
    const integrity = ctx.db.raw.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const first = integrity[0]?.integrity_check ?? '(no output)';
    out(`integrity_check:    ${first}`);

    try {
      const [v] = await ctx.embeddings.embed(['darkcontext healthcheck']);
      out(`embed sample:       ok (dim ${v?.length ?? 0})`);
    } catch (err) {
      out(`embed sample:       FAILED — ${(err as Error).message}`);
    }

    out('');
    out('row counts:');
    for (const table of COUNT_TABLES) {
      const row = ctx.db.raw.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number };
      out(`  ${table.padEnd(16)} ${row.c}`);
    }
  });
}

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check store + embeddings health (schema version, integrity, table counts)')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (opts: CommonCliOptions) => {
      await runDoctor(opts);
    });
}
