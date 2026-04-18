import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ScopeFilter } from '../scopeFilter.js';
import { withAudit } from '../audit.js';
import type { AuditSink } from '../../core/audit/index.js';
import type { ToolWithGrants } from '../../core/tools/index.js';

export function registerWorkspaceTools(
  server: McpServer,
  filter: ScopeFilter,
  auditor: AuditSink,
  caller: ToolWithGrants
): void {
  server.registerTool(
    'list_workspaces',
    {
      title: 'List workspaces',
      description: 'List workspaces the calling tool can read.',
      inputSchema: {},
    },
    withAudit(auditor, caller, 'list_workspaces', () => {
      const workspaces = filter.listWorkspaces();
      const lines = workspaces.map(
        (w) => `${w.isActive ? '* ' : '  '}${w.name} [${w.scope ?? '-'}]`
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: workspaces.length === 0 ? '(no workspaces)' : lines.join('\n'),
          },
        ],
        structuredContent: { workspaces },
      };
    })
  );

  server.registerTool(
    'get_active_workspace',
    {
      title: 'Get the active workspace',
      description:
        'Return the currently active workspace if the calling tool can read it; null otherwise.',
      inputSchema: {},
    },
    withAudit(auditor, caller, 'get_active_workspace', () => {
      const active = filter.getActiveWorkspace();
      return {
        content: [
          {
            type: 'text' as const,
            text: active ? `${active.name} [${active.scope ?? '-'}]` : '(no active workspace)',
          },
        ],
        structuredContent: { workspace: active },
      };
    })
  );

  server.registerTool(
    'add_to_workspace',
    {
      title: 'Add an item to a workspace',
      description:
        "Attach an item (kind: 'task', 'goal', 'note', 'thread', ...) to a workspace. If workspaceId is omitted, the active workspace is used.",
      inputSchema: {
        kind: z.string().min(1).describe("Item kind: task, goal, note, thread, etc."),
        content: z.string().min(1).describe('Item body.'),
        workspaceId: z.number().int().positive().optional().describe('Target workspace id; defaults to active.'),
        state: z.string().optional().describe("Lifecycle state (default 'open')."),
      },
    },
    withAudit(auditor, caller, 'add_to_workspace', (args) => {
      const item = filter.addToWorkspace({
        kind: args.kind,
        content: args.content,
        ...(args.workspaceId !== undefined ? { workspaceId: args.workspaceId } : {}),
        ...(args.state ? { state: args.state } : {}),
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: `Added ${item.kind} #${item.id} to workspace ${item.workspaceId}.`,
          },
        ],
        structuredContent: { item },
      };
    })
  );
}
