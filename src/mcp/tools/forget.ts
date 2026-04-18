import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ScopeFilter } from '../scopeFilter.js';
import { toToolError } from './errors.js';

const shape = {
  id: z.number().int().positive().describe('Memory id to delete.'),
};

export function registerForgetTool(server: McpServer, filter: ScopeFilter): void {
  server.registerTool(
    'forget',
    {
      title: 'Forget a memory',
      description:
        "Delete a memory by id. Silently no-ops if the memory does not exist or is outside the calling tool's writable scopes (to avoid leaking existence).",
      inputSchema: shape,
    },
    (args) => {
      try {
        const ok = filter.forget(args.id);
        return {
          content: [
            { type: 'text' as const, text: ok ? `Forgot #${args.id}.` : `No memory with id ${args.id}.` },
          ],
          structuredContent: { deleted: ok, id: args.id },
        };
      } catch (err) {
        return toToolError(err);
      }
    }
  );
}
