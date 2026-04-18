import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';

function cipherStatus(hasCipher: boolean, keySet: boolean): string {
  if (hasCipher) return 'SQLCipher active';
  if (keySet) {
    return 'key set but SQLCipher not detected — stock better-sqlite3 does not encrypt. See docs/SECURITY.md.';
  }
  return 'disabled (set DARKCONTEXT_ENCRYPTION_KEY + a SQLCipher build to enable)';
}

export async function runDoctor(
  opts: CommonCliOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  await withAppContext(opts, async (ctx) => {
    out(`db path:            ${ctx.config.dbPath}`);
    out(`sqlite-vec:         ${ctx.db.hasVec ? 'ok' : 'MISSING (falling back to keyword search)'}`);
    out(`encryption:         ${cipherStatus(ctx.db.hasCipher, !!ctx.config.encryptionKey)}`);
    out(`embed dim (stored): ${ctx.db.embedDim || '(none yet)'}`);
    out(`provider:           ${ctx.embeddings.name}`);
    try {
      const [v] = await ctx.embeddings.embed(['darkcontext healthcheck']);
      out(`embed sample:       ok (dim ${v?.length ?? 0})`);
    } catch (err) {
      out(`embed sample:       FAILED — ${(err as Error).message}`);
    }
  });
}

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check store + embeddings health')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (opts: CommonCliOptions) => {
      await runDoctor(opts);
    });
}
