import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';

export interface PruneOptions extends CommonCliOptions {
  scope?: string;
  dryRun?: boolean;
}

export async function runPrune(
  opts: PruneOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  await withAppContext(opts, async (ctx) => {
    const result = ctx.retention.prune({
      ...(opts.scope ? { scope: opts.scope } : {}),
      ...(opts.dryRun ? { dryRun: true } : {}),
    });

    if (result.scanned === 0) {
      out(
        opts.scope
          ? `scope '${opts.scope}' has no retention rule — nothing to prune`
          : 'no scopes have retention rules configured — nothing to prune'
      );
      return;
    }

    const prefix = result.dryRun ? 'would delete' : 'deleted';
    for (const scope of result.scopes) {
      const cutoffIso = new Date(scope.cutoff).toISOString();
      out(
        `${scope.scope} (retention ${scope.days}d, cutoff ${cutoffIso}): ` +
          `${prefix} memories=${scope.counts.memories} ` +
          `documents=${scope.counts.documents} ` +
          `conversations=${scope.counts.conversations} ` +
          `workspace_items=${scope.counts.workspaceItems}`
      );
    }
    out(
      `total: ${prefix} memories=${result.total.memories} ` +
        `documents=${result.total.documents} ` +
        `conversations=${result.total.conversations} ` +
        `workspace_items=${result.total.workspaceItems}`
    );
  });
}

export function registerPrune(program: Command): void {
  program
    .command('prune')
    .description('Delete content in retention-enabled scopes that has aged past its retention window')
    .option('--scope <name>', 'only prune this scope (must have a retention rule)')
    .option('--dry-run', 'report what would be deleted without deleting anything', false)
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (opts: PruneOptions) => {
      await runPrune(opts);
    });
}
