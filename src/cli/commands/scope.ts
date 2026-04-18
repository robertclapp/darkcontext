import type { Command } from 'commander';

import { openDb } from '../../core/store/db.js';
import { Scopes } from '../../core/scopes/index.js';

export function registerScopeCommands(program: Command): void {
  const scope = program.command('scope').description('Manage scopes');

  scope
    .command('add <name>')
    .description('Create a new scope')
    .option('--description <desc>', 'human-readable description')
    .option('--db <path>', 'override database path')
    .action((name: string, opts: { description?: string; db?: string }) => {
      const db = openDb(opts.db ? { path: opts.db } : {});
      try {
        const s = new Scopes(db).upsert(name, opts.description);
        console.log(`scope '${s.name}' ready (#${s.id})`);
      } finally {
        db.close();
      }
    });

  scope
    .command('list')
    .description('List all scopes')
    .option('--db <path>', 'override database path')
    .action((opts: { db?: string }) => {
      const db = openDb(opts.db ? { path: opts.db } : {});
      try {
        const scopes = new Scopes(db).list();
        for (const s of scopes) {
          console.log(`${s.name}${s.description ? `  — ${s.description}` : ''}`);
        }
      } finally {
        db.close();
      }
    });

  scope
    .command('remove <name>')
    .description("Delete a scope (cannot remove 'default')")
    .option('--db <path>', 'override database path')
    .action((name: string, opts: { db?: string }) => {
      const db = openDb(opts.db ? { path: opts.db } : {});
      try {
        const ok = new Scopes(db).remove(name);
        console.log(ok ? `removed scope '${name}'` : `no scope named '${name}'`);
      } finally {
        db.close();
      }
    });
}
