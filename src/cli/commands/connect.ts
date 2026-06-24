import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';
import { ConflictError, ValidationError } from '../../core/errors.js';

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
  /** Tool with this name already exists → rotate its token instead of erroring. */
  rotate?: boolean;
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
  // Validate empty / whitespace `--db` and `--provider` explicitly. With a
  // bare truthy check `--db ""` would silently drop the flag from the
  // generated `dcx serve` command — the user would get a config that
  // launches the server with the default DB / provider, not the one they
  // typed. Matches the empty-string rejection added across the rest of
  // the CLI family (export/prune/summarize/sync).
  const db = opts.db !== undefined ? opts.db.trim() : undefined;
  if (db === '') throw new ValidationError('db', '--db must be a non-empty path');
  const provider = opts.provider !== undefined ? opts.provider.trim() : undefined;
  if (provider === '') throw new ValidationError('provider', '--provider must be a non-empty string');
  // Charset validation (`^[A-Za-z0-9_-]+$`) is enforced inside
  // `Tools.create()` so every persistence path is protected uniformly —
  // not just this one CLI command.

  await withAppContext(opts, (ctx) => {
    const serveArgs: string[] = ['serve'];
    if (db !== undefined) serveArgs.push('--db', db);
    if (provider !== undefined) serveArgs.push('--provider', provider);

    let token: string;
    let rotated = false;
    // What the success line reports. For a fresh create these mirror the
    // CLI inputs, but on the rotate-existing branch they MUST be sourced
    // from the tool's real grants: rotateToken only mints a new secret and
    // leaves scopes / read-only untouched, so echoing --scopes/--read-only
    // there would advertise a boundary the token doesn't actually have.
    let effectiveScopes = scopes;
    let effectiveReadOnly = opts.readOnly ?? false;
    if (opts.rotate) {
      // --rotate: keep existing scope grants, just mint a new token.
      // If the tool doesn't exist yet, fall through to create() so
      // `--rotate` is idempotent for first-time setup.
      const existing = ctx.tools.findByName(toolName);
      if (existing) {
        token = ctx.tools.rotateToken(toolName);
        rotated = true;
        const grants = ctx.tools.grantsFor(existing.id);
        effectiveScopes = grants.map((g) => g.scope);
        // A tool is read-only when no grant carries write access.
        effectiveReadOnly = grants.length > 0 && grants.every((g) => !g.canWrite);
      } else {
        ({ token } = ctx.tools.create({ name: toolName, scopes, readOnly: opts.readOnly ?? false }));
      }
    } else {
      try {
        ({ token } = ctx.tools.create({ name: toolName, scopes, readOnly: opts.readOnly ?? false }));
      } catch (err) {
        // Translate the raw ConflictError into actionable guidance.
        // Without this, a re-run of `dcx connect <client>` (after the
        // token-shown-once has been lost) surfaces a generic conflict
        // error with no recovery path.
        if (err instanceof ConflictError) {
          throw new ValidationError(
            'name',
            `a tool named '${toolName}' already exists. ` +
              `Pass --rotate to mint a new token for it, or --name <other> to provision a second identity.`
          );
        }
        throw err;
      }
    }

    const readOnlyTag = effectiveReadOnly ? ' (read-only)' : '';
    const verb = rotated ? 'Rotated token for' : 'Provisioned';
    out(`${verb} '${toolName}' for ${client} — scopes: ${effectiveScopes.join(', ')}${readOnlyTag}`);
    if (rotated) {
      // Rotation only mints a new secret; it never alters grants. Say so,
      // so a user who passed --scopes/--read-only understands why the line
      // above reflects the tool's existing boundary, not their flags.
      out('  (rotation preserves the existing scopes/read-only; flags do not change grants)');
    }
    out('');
    out(renderClientConfig(client, toolName, token, serveArgs));
    out('');
    out('The token is shown once. Re-run with `--rotate` to mint a new one for this name, or `--name <other>` to provision a second identity.');
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
    .option('--rotate', 'if the named tool already exists, mint a new token instead of erroring', false)
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
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
