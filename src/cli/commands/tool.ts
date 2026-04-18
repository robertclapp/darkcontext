import type { Command } from 'commander';

import { openDb } from '../../core/store/db.js';
import { Tools } from '../../core/tools/index.js';
import { defaultDbPath } from '../../core/store/paths.js';

export function registerToolCommands(program: Command): void {
  const tool = program.command('tool').description('Manage MCP tool identities');

  tool
    .command('add <name>')
    .description('Provision a new tool, grant scopes, and print its bearer token')
    .requiredOption('--scopes <scopes>', 'comma-separated scope names')
    .option('--read-only', 'tool can read but not write the granted scopes', false)
    .option('--db <path>', 'override database path')
    .action(
      (
        name: string,
        opts: { scopes: string; readOnly: boolean; db?: string }
      ) => {
        const db = openDb(opts.db ? { path: opts.db } : {});
        try {
          const tools = new Tools(db);
          const scopes = parseList(opts.scopes);
          const result = tools.create({ name, scopes, readOnly: opts.readOnly });

          console.log(`Provisioned tool '${result.tool.name}' (#${result.tool.id})`);
          console.log(`Scopes:`);
          for (const g of result.grants) {
            const perms = [g.canRead ? 'read' : null, g.canWrite ? 'write' : null].filter(Boolean);
            console.log(`  - ${g.scope} (${perms.join(', ')})`);
          }
          console.log('');
          console.log('TOKEN (save now — will not be shown again):');
          console.log(`  ${result.token}`);
          console.log('');
          console.log('Claude Desktop / MCP client config snippet:');
          console.log(
            JSON.stringify(
              {
                mcpServers: {
                  [result.tool.name]: {
                    command: 'dcx',
                    args: ['serve', ...(opts.db ? ['--db', opts.db] : [])],
                    env: { DARKCONTEXT_TOKEN: result.token },
                  },
                },
              },
              null,
              2
            )
          );
        } finally {
          db.close();
        }
      }
    );

  tool
    .command('list')
    .description('List provisioned tools and their scopes')
    .option('--db <path>', 'override database path')
    .action((opts: { db?: string }) => {
      const db = openDb(opts.db ? { path: opts.db } : {});
      try {
        const tools = new Tools(db);
        const all = tools.list();
        if (all.length === 0) {
          console.log('(no tools)');
          return;
        }
        for (const t of all) {
          const grants = t.grants
            .map((g) => `${g.scope}:${g.canRead ? 'r' : '-'}${g.canWrite ? 'w' : '-'}`)
            .join(' ');
          const seen = t.lastSeenAt ? new Date(t.lastSeenAt).toISOString() : 'never';
          console.log(`${t.name.padEnd(20)} [${grants}]  last_seen=${seen}`);
        }
      } finally {
        db.close();
      }
    });

  tool
    .command('revoke <name>')
    .description('Delete a tool and its grants')
    .option('--db <path>', 'override database path')
    .action((name: string, opts: { db?: string }) => {
      const db = openDb(opts.db ? { path: opts.db } : {});
      try {
        const ok = new Tools(db).revoke(name);
        console.log(ok ? `revoked ${name}` : `no tool named ${name}`);
      } finally {
        db.close();
      }
    });

  tool
    .command('rotate <name>')
    .description('Rotate a tool bearer token')
    .option('--db <path>', 'override database path')
    .action((name: string, opts: { db?: string }) => {
      const db = openDb(opts.db ? { path: opts.db } : {});
      try {
        const token = new Tools(db).rotateToken(name);
        console.log(`New token for '${name}':`);
        console.log(`  ${token}`);
        console.log(`(DB: ${opts.db ?? defaultDbPath()})`);
      } finally {
        db.close();
      }
    });
}

function parseList(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
