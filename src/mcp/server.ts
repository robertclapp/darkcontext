import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { AppContext, type ContextInit } from '../core/context.js';
import type { AuditSink } from '../core/audit/index.js';

import { resolveToolFromEnv } from './auth.js';
import { ScopeFilter } from './scopeFilter.js';
import { registerAllMcpTools } from './tools/registry.js';

export interface ServeOptions extends ContextInit {
  env?: NodeJS.ProcessEnv;
}

export interface StartedServer {
  server: McpServer;
  filter: ScopeFilter;
  close: () => Promise<void>;
}

/**
 * Construct a fully wired MCP server for a given scope-filtered context.
 * Transport-agnostic: pair with stdio, HTTP, or InMemoryTransport.
 */
export function buildServer(filter: ScopeFilter, auditor: AuditSink): McpServer {
  const server = new McpServer(
    { name: 'darkcontext', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );
  registerAllMcpTools(server, filter, auditor);
  return server;
}

/**
 * Start the MCP server over stdio. Opens an AppContext, authenticates from
 * env, wires the server, and returns a close handle that tears everything
 * down cleanly.
 *
 * If authentication fails (missing/unknown token), the context is closed
 * before the error propagates — no DB leak.
 */
export async function startStdioServer(opts: ServeOptions = {}): Promise<StartedServer> {
  const ctx = AppContext.open(opts);

  let callerTool;
  try {
    callerTool = resolveToolFromEnv(ctx.tools, opts.env);
  } catch (err) {
    ctx.close();
    throw err;
  }

  const filter = new ScopeFilter(callerTool, {
    memories: ctx.memories,
    documents: ctx.documents,
    workspaces: ctx.workspaces,
    conversations: ctx.conversations,
  });
  const auditor = ctx.newAuditLog(callerTool);
  const server = buildServer(filter, auditor);

  const transport: Transport = new StdioServerTransport();
  await server.connect(transport);

  return {
    server,
    filter,
    close: async () => {
      await server.close();
      ctx.close();
    },
  };
}
