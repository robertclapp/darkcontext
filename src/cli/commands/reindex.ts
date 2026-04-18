import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';
import { ValidationError } from '../../core/errors.js';

type ReindexKind = 'memories' | 'documents' | 'history';
const ALL_KINDS: readonly ReindexKind[] = ['memories', 'documents', 'history'];

interface ReindexOptions extends CommonCliOptions {
  only?: string;
}

export async function runReindex(
  opts: ReindexOptions,
  out: (l: string) => void = console.log
): Promise<void> {
  const want = parseOnly(opts.only);
  await withAppContext(opts, async (ctx) => {
    if (!ctx.db.hasVec) {
      throw new Error('sqlite-vec is not loaded — reindex cannot run. Install the sqlite-vec native binary.');
    }
    out(`reindexing ${want.join(', ')} via ${ctx.embeddings.name} at ${ctx.config.dbPath}`);
    if (want.includes('memories')) out(`  memories: ${await ctx.memories.reindex()} rows`);
    if (want.includes('documents')) out(`  document_chunks: ${await ctx.documents.reindex()} rows`);
    if (want.includes('history')) out(`  messages: ${await ctx.conversations.reindex()} rows`);
  });
}

export function registerReindex(program: Command): void {
  program
    .command('reindex')
    .description(
      'Rebuild vector indexes (memories, document chunks, messages) from stored content. Use after swapping embedding providers or to recover vectors that failed to write during ingest.'
    )
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .option('--only <kinds>', 'comma-separated subset: memories,documents,history (default: all)')
    .action(async (opts: ReindexOptions) => {
      await runReindex(opts);
    });
}

function parseOnly(raw: string | undefined): ReindexKind[] {
  if (!raw) return [...ALL_KINDS];
  const out: ReindexKind[] = [];
  for (const name of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    if ((ALL_KINDS as readonly string[]).includes(name)) {
      out.push(name as ReindexKind);
    } else {
      throw new ValidationError('only', `unknown kind '${name}' (expected memories | documents | history)`);
    }
  }
  return out;
}
