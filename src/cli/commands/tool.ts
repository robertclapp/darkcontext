import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';
import type { ProvisionedTool } from '../../core/tools/index.js';

export interface ToolAddOptions extends CommonCliOptions {
  scopes: string;
  readOnly: boolean;
  /** Emit the provisioning result as a single JSON object instead of the
   *  human-readable banner. Useful for scripts that mint a token and pipe
   *  the result through `jq` (see examples/curl-http-demo.sh). */
  json?: boolean;
}

/**
 * Public, scriptable shape of `dcx tool add --json`.
 *
 * Callers (CI scripts, the `examples/curl-http-demo.sh` launcher, the
 * Claude Desktop config generator in MCP clients) can depend on this
 * object staying shape-stable across patch releases. Fields:
 *
 *   tool         — the stored row (id, name, timestamps, last_seen).
 *   token        — plaintext bearer token. Returned ONCE by construction;
 *                  the store keeps only the sha256 hash.
 *   grants       — explicit permissions per scope.
 *   mcpServerConfig — a drop-in `mcpServers[<name>]` entry for any MCP
 *                  client that speaks the Claude Desktop config shape.
 */
export interface ToolAddJsonOutput {
  tool: ProvisionedTool['tool'];
  token: string;
  grants: ProvisionedTool['grants'];
  mcpServerConfig: {
    command: string;
    args: string[];
    env: Record<string, string>;
  };
}

export async function runToolAdd(
  name: string,
  opts: ToolAddOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  await withAppContext(opts, (ctx) => {
    const result = ctx.tools.create({
      name,
      scopes: parseList(opts.scopes),
      readOnly: opts.readOnly,
    });

    const mcpServerConfig = {
      command: 'dcx',
      args: ['serve', ...(opts.db ? ['--db', opts.db] : [])],
      env: { DARKCONTEXT_TOKEN: result.token },
    };

    if (opts.json) {
      const payload: ToolAddJsonOutput = {
        tool: result.tool,
        token: result.token,
        grants: result.grants,
        mcpServerConfig,
      };
      out(JSON.stringify(payload));
      return;
    }

    out(`Provisioned tool '${result.tool.name}' (#${result.tool.id})`);
    out('Scopes:');
    for (const g of result.grants) {
      const perms = [g.canRead ? 'read' : null, g.canWrite ? 'write' : null].filter(Boolean);
      out(`  - ${g.scope} (${perms.join(', ')})`);
    }
    out('');
    out('TOKEN (save now — will not be shown again):');
    out(`  ${result.token}`);
    out('');
    out('Claude Desktop / MCP client config snippet:');
    out(JSON.stringify({ mcpServers: { [result.tool.name]: mcpServerConfig } }, null, 2));
  });
}

export function registerToolCommands(program: Command): void {
  const tool = program.command('tool').description('Manage MCP tool identities');

  tool
    .command('add <name>')
    .description('Provision a new tool, grant scopes, and print its bearer token')
    .requiredOption('--scopes <scopes>', 'comma-separated scope names')
    .option('--read-only', 'tool can read but not write the granted scopes', false)
    .option('--json', 'emit a single JSON object (script-friendly) instead of the human banner', false)
    .option('--db <path>', 'override database path')
    .action(async (name: string, opts: ToolAddOptions) => {
      await runToolAdd(name, opts);
    });

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
