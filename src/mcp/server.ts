import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { Memories } from '../core/memories/index.js';
import { Documents } from '../core/documents/index.js';
import { Workspaces } from '../core/workspace/index.js';
import { Conversations } from '../core/conversations/index.js';
import { Tools } from '../core/tools/index.js';
import { createEmbeddingProvider, resolveProviderKind } from '../core/embeddings/index.js';
import { openDb } from '../core/store/db.js';

import { resolveToolFromEnv } from './auth.js';
import { ScopeFilter } from './scopeFilter.js';
import { registerRememberTool } from './tools/remember.js';
import { registerRecallTool } from './tools/recall.js';
import { registerForgetTool } from './tools/forget.js';
import { registerSearchDocumentsTool } from './tools/searchDocuments.js';
import { registerSearchHistoryTool } from './tools/searchHistory.js';
import { registerWorkspaceTools } from './tools/workspace.js';

export interface ServeOptions {
  dbPath?: string;
  provider?: string;
  env?: NodeJS.ProcessEnv;
}

export interface StartedServer {
  server: McpServer;
  filter: ScopeFilter;
  close: () => Promise<void>;
}

/**
 * Build an MCP server wired to a DarkContext store and tool identity, without
 * connecting it to any transport yet. Exported so tests can pair it with the
 * SDK's in-memory transport.
 */
export function buildServer(filter: ScopeFilter): McpServer {
  const server = new McpServer(
    { name: 'darkcontext', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );
  registerRememberTool(server, filter);
  registerRecallTool(server, filter);
  registerForgetTool(server, filter);
  registerSearchDocumentsTool(server, filter);
  registerSearchHistoryTool(server, filter);
  registerWorkspaceTools(server, filter);
  return server;
}

/** Wire up a DarkContext MCP server + stdio transport for production use. */
export async function startStdioServer(opts: ServeOptions = {}): Promise<StartedServer> {
  const db = openDb(opts.dbPath ? { path: opts.dbPath } : {});
  const embeddings = createEmbeddingProvider(resolveProviderKind(opts.provider));
  const memories = new Memories(db, embeddings);
  const documents = new Documents(db, embeddings);
  const workspaces = new Workspaces(db);
  const conversations = new Conversations(db, embeddings);
  const toolsStore = new Tools(db);

  const callerTool = resolveToolFromEnv(toolsStore, opts.env);
  const filter = new ScopeFilter(callerTool, { memories, documents, workspaces, conversations });

  const server = buildServer(filter);
  const transport: Transport = new StdioServerTransport();
  await server.connect(transport);

  return {
    server,
    filter,
    close: async () => {
      await server.close();
      db.close();
    },
  };
}
