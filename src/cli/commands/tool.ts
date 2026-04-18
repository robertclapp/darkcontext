import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';

export function registerToolCommands(program: Command): void {
  const tool = program.command('tool').description('Manage MCP tool identities');

  tool
    .command('add <name>')
    .description('Provision a new tool, grant scopes, and print its bearer token')
    .requiredOption('--scopes <scopes>', 'comma-separated scope names')
    .option('--read-only', 'tool can read but not write the granted scopes', false)
    .option('--db <path>', 'override database path')
    .action(
      async (
        name: string,
        opts: CommonCliOptions & { scopes: string; readOnly: boolean }
      ) => {
        await withAppContext(opts, (ctx) => {
          const result = ctx.tools.create({
            name,
            scopes: parseList(opts.scopes),
            readOnly: opts.readOnly,
          });
          console.log(`Provisioned tool '${result.tool.name}' (#${result.tool.id})`);
          console.log('Scopes:');
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
        });
      }
    );

  tool
    .command('list')
    .description('List provisioned tools and their scopes')
    .option('--db <path>', 'override database path')
    .action(async (opts: CommonCliOptions) => {
      await withAppContext(opts, (ctx) => {
        const all = ctx.tools.list();
        if (all.length === 0) return console.log('(no tools)');
        for (const t of all) {
          const grants = t.grants
            .map((g) => `${g.scope}:${g.canRead ? 'r' : '-'}${g.canWrite ? 'w' : '-'}`)
            .join(' ');
          const seen = t.lastSeenAt ? new Date(t.lastSeenAt).toISOString() : 'never';
          console.log(`${t.name.padEnd(20)} [${grants}]  last_seen=${seen}`);
        }
      });
    });

  tool
    .command('revoke <name>')
    .description('Delete a tool and its grants')
    .option('--db <path>', 'override database path')
    .action(async (name: string, opts: CommonCliOptions) => {
      await withAppContext(opts, (ctx) => {
        console.log(ctx.tools.revoke(name) ? `revoked ${name}` : `no tool named ${name}`);
      });
    });

  tool
    .command('rotate <name>')
    .description('Rotate a tool bearer token')
    .option('--db <path>', 'override database path')
    .action(async (name: string, opts: CommonCliOptions) => {
      await withAppContext(opts, (ctx) => {
        const token = ctx.tools.rotateToken(name);
        console.log(`New token for '${name}':`);
        console.log(`  ${token}`);
        console.log(`(DB: ${ctx.config.dbPath})`);
      });
    });
}

function parseList(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
