import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';

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
    .description('List all scopes')
    .option('--db <path>', 'override database path')
    .action(async (opts: CommonCliOptions) => {
      await withAppContext(opts, (ctx) => {
        for (const s of ctx.scopes.list()) {
          console.log(`${s.name}${s.description ? `  — ${s.description}` : ''}`);
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
}
