import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';
import { ValidationError } from '../../core/errors.js';

export function registerScopeCommands(program: Command): void {
  const scope = program.command('scope').description('Manage scopes');

  scope
    .command('add <name>')
    .description('Create a new scope')
    .option('--description <desc>', 'human-readable description')
    .option('--db <path>', 'override database path')
    .action(async (name: string, opts: CommonCliOptions & { description?: string }) => {
      await withAppContext(opts, (ctx) => {
        const s = ctx.scopes.upsert(name, opts.description);
        console.log(`scope '${s.name}' ready (#${s.id})`);
      });
    });

  scope
    .command('list')
    .description('List all scopes (with retention if set)')
    .option('--db <path>', 'override database path')
    .action(async (opts: CommonCliOptions) => {
      await withAppContext(opts, (ctx) => {
        const retentionByScope = new Map(
          ctx.retention.list().map((r) => [r.scope, r.days])
        );
        for (const s of ctx.scopes.list()) {
          const days = retentionByScope.get(s.name);
          const retentionStr = days ? `  (retention: ${days}d)` : '';
          const descStr = s.description ? `  — ${s.description}` : '';
          console.log(`${s.name}${descStr}${retentionStr}`);
        }
      });
    });

  scope
    .command('remove <name>')
    .description("Delete a scope (cannot remove 'default')")
    .option('--db <path>', 'override database path')
    .action(async (name: string, opts: CommonCliOptions) => {
      await withAppContext(opts, (ctx) => {
        const ok = ctx.scopes.remove(name);
        console.log(ok ? `removed scope '${name}'` : `no scope named '${name}'`);
      });
    });

  scope
    .command('set-retention <name> <days>')
    .description('Set retention policy for a scope (days must be a positive integer)')
    .option('--db <path>', 'override database path')
    .action(async (name: string, daysRaw: string, opts: CommonCliOptions) => {
      const days = Number(daysRaw);
      if (!Number.isInteger(days) || days <= 0) {
        throw new ValidationError('days', `must be a positive integer, got '${daysRaw}'`);
      }
      await withAppContext(opts, (ctx) => {
        const rule = ctx.retention.set(name, days);
        console.log(`retention for scope '${rule.scope}' set to ${rule.days}d`);
      });
    });

  scope
    .command('clear-retention <name>')
    .description('Remove the retention policy for a scope (data is retained forever)')
    .option('--db <path>', 'override database path')
    .action(async (name: string, opts: CommonCliOptions) => {
      await withAppContext(opts, (ctx) => {
        const ok = ctx.retention.clear(name);
        console.log(ok ? `cleared retention for scope '${name}'` : `scope '${name}' had no retention rule`);
      });
    });
}
