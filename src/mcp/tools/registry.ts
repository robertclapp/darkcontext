import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AuditSink } from '../../core/audit/index.js';

import type { ScopeFilter } from '../scopeFilter.js';
import { withAudit } from '../audit.js';

import { rememberTool } from './remember.js';
import { recallTool } from './recall.js';
import { forgetTool } from './forget.js';
import { searchDocumentsTool } from './searchDocuments.js';
import { searchHistoryTool } from './searchHistory.js';
import { listWorkspacesTool } from './listWorkspaces.js';
import { getActiveWorkspaceTool } from './getActiveWorkspace.js';
import { addToWorkspaceTool } from './addToWorkspace.js';
import type { McpToolDef } from './types.js';

/**
 * The single source of truth for the MCP tool surface. Adding a new tool
 * means writing its `defineTool(...)` file and appending it here. Nothing
 * else registers tools with the server.
 */
export const ALL_MCP_TOOLS: readonly McpToolDef[] = [
  rememberTool,
  recallTool,
  forgetTool,
  searchDocumentsTool,
  searchHistoryTool,
  listWorkspacesTool,
  getActiveWorkspaceTool,
  addToWorkspaceTool,
];

export function registerAllMcpTools(
  server: McpServer,
  filter: ScopeFilter,
  auditor: AuditSink
): void {
  const caller = filter.caller;
  const toolCtx = { filter };
  for (const tool of ALL_MCP_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.annotations ? { annotations: tool.annotations } : {}),
      },
      // The aggregator erases per-tool arg types down to `unknown` — Zod
      // validates at the MCP-SDK boundary before the handler runs, so this
      // cast is safe. Per-tool types are preserved inside each tool file.
      withAudit(auditor, caller, tool.name, (args) =>
        (tool.handler as (a: unknown, c: typeof toolCtx) => ReturnType<typeof tool.handler>)(
          args,
          toolCtx
        )
      ) as never
    );
  }
}
