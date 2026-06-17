import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';
import { ValidationError } from '../../core/errors.js';

/**
 * `dcx connect <client>` — one step from "installed" to "this agent shares
 * my context". It provisions a bearer token and prints the exact, paste-able
 * config block for the named client, so the user never hand-writes an MCP
 * server entry. Defaults to a single shared scope so every connected agent
 * reads and writes the SAME context — that's the "shared across agents
 * without wiring it manually" ask; pass `--scopes` to draw a tighter boundary.
 */

const CLIENTS = ['claude-code', 'claude-desktop', 'cursor', 'codex'] as const;
type Client = (typeof CLIENTS)[number];

export interface ConnectOptions extends CommonCliOptions {
  name?: string;
  scopes: string;
  readOnly?: boolean;
}

export async function runConnect(
  client: string,
  opts: ConnectOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  if (!isClient(client)) {
    throw new ValidationError('client', `unknown client '${client}' (expected: ${CLIENTS.join(', ')})`);
  }
  const scopes = normalizeScopes(opts.scopes);
  if (scopes.length === 0) {
    throw new ValidationError('scopes', 'at least one non-empty scope is required');
  }
  const toolName = (opts.name ?? client).trim();

  await withAppContext(opts, (ctx) => {
    const { token } = ctx.tools.create({ name: toolName, scopes, readOnly: opts.readOnly ?? false });
    // Forward the same overrides the user passed to `connect` into the
    // generated `dcx serve` command. Without this, `dcx connect …
    // --provider onnx` prints a config that launches the server with
    // the default embeddings provider — a silent mismatch the user
    // would only notice later via wrong recall results.
    const serveArgs: string[] = ['serve'];
    if (opts.db) serveArgs.push('--db', opts.db);
    if (opts.provider) serveArgs.push('--provider', opts.provider);

    const readOnlyTag = opts.readOnly ? ' (read-only)' : '';
    out(`Provisioned '${toolName}' for ${client} — scopes: ${scopes.join(', ')}${readOnlyTag}`);
    out('');
    out(renderClientConfig(client, toolName, token, serveArgs));
    out('');
    out('The token is shown once. Re-run with `--name` to provision another client against the same shared scope.');
  });
}

function renderClientConfig(client: Client, toolName: string, token: string, args: string[]): string {
  const mcpServers = {
    mcpServers: { [toolName]: { command: 'dcx', args, env: { DARKCONTEXT_TOKEN: token } } },
  };

  switch (client) {
    case 'claude-code':
      // Claude Code reads project-level `.mcp.json` (mcpServers shape) and
      // also supports `claude mcp add-json`. Offer the one-liner + the file.
      return [
        'Option A — run this once in your repo:',
        `  claude mcp add-json ${toolName} '${JSON.stringify({ command: 'dcx', args, env: { DARKCONTEXT_TOKEN: token } })}'`,
        '',
        'Option B — add to .mcp.json at the repo root:',
        JSON.stringify(mcpServers, null, 2),
      ].join('\n');

    case 'claude-desktop':
      return [
        'Add to claude_desktop_config.json (Settings → Developer → Edit Config):',
        JSON.stringify(mcpServers, null, 2),
      ].join('\n');

    case 'cursor':
      return [
        'Add to .cursor/mcp.json (project) or ~/.cursor/mcp.json (global):',
        JSON.stringify(mcpServers, null, 2),
      ].join('\n');

    case 'codex':
      // Codex CLI uses ~/.codex/config.toml with [mcp_servers.<name>].
      return [
        'Add to ~/.codex/config.toml:',
        `[mcp_servers.${toolName}]`,
        `command = "dcx"`,
        `args = ${JSON.stringify(args)}`,
        `env = { DARKCONTEXT_TOKEN = ${JSON.stringify(token)} }`,
      ].join('\n');
  }
}

export function registerConnect(program: Command): void {
  program
    .command('connect <client>')
    .description(`Provision a token + print paste-ready MCP config for an agent (${CLIENTS.join(' | ')})`)
    .option('--name <name>', 'tool identity name (default: the client name)')
    .option('--scopes <scopes>', 'comma-separated scopes (default: shared)', 'shared')
    .option('--read-only', 'grant read-only access to the scopes', false)
    .option('--db <path>', 'override database path')
    .action(async (client: string, opts: ConnectOptions) => {
      await runConnect(client, opts);
    });
}

function isClient(v: string): v is Client {
  return (CLIENTS as readonly string[]).includes(v);
}

/** Split comma-separated input, trim, drop empties, preserve first-seen order. */
function normalizeScopes(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
