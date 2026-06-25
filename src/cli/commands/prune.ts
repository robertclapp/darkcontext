import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';
import { NotFoundError, ValidationError } from '../../core/errors.js';

export interface PruneOptions extends CommonCliOptions {
  scope?: string;
  dryRun?: boolean;
}

export async function runPrune(
  opts: PruneOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  // Reject empty / whitespace-only `--scope` explicitly. `prune` is
  // destructive: with a truthy check, `--scope "$SCOPE"` against an
  // unset variable would silently drop the filter and sweep EVERY
  // retention-enabled scope. Trim + reject when the caller named a
  // scope but the value collapses to nothing, so the failure is loud
  // rather than silently broader.
  const scope = opts.scope !== undefined ? opts.scope.trim() : undefined;
  if (scope === '') {
    throw new ValidationError('scope', '--scope must be a non-empty string');
  }

  await withAppContext(opts, async (ctx) => {
    // Retention.prune({ scope }) THROWS NotFoundError when the named
    // scope has no rule. A separate `get()` pre-check would race against
    // the prune (rule could be cleared between the two calls and still
    // surface an uncaught throw), so handle the error at the point of
    // execution instead and collapse it to the friendly line.
    let result;
    try {
      result = ctx.retention.prune({
        ...(scope !== undefined ? { scope } : {}),
        ...(opts.dryRun ? { dryRun: true } : {}),
      });
    } catch (err) {
      if (scope !== undefined && err instanceof NotFoundError) {
        out(`scope '${scope}' has no retention rule — nothing to prune`);
        return;
      }
      throw err;
    }

    if (result.scanned === 0) {
      out(
        opts.scope
          ? `scope '${opts.scope}' has no retention rule — nothing to prune`
          : 'no scopes have retention rules configured — nothing to prune'
      );
      return;
    }

    const prefix = result.dryRun ? 'would delete' : 'deleted';
    for (const scopeResult of result.scopes) {
      const cutoffIso = new Date(scopeResult.cutoff).toISOString();
      out(
        `${scopeResult.scope} (retention ${scopeResult.days}d, cutoff ${cutoffIso}): ` +
          `${prefix} memories=${scopeResult.counts.memories} ` +
          `documents=${scopeResult.counts.documents} ` +
          `conversations=${scopeResult.counts.conversations} ` +
          `workspace_items=${scopeResult.counts.workspaceItems}`
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
