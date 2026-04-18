import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ScopeFilter } from '../scopeFilter.js';
import { toToolError } from './errors.js';

const shape = {
  content: z.string().min(1).describe('The fact, preference, or note to remember.'),
  kind: z.string().optional().describe("Category (default 'fact'); e.g. 'preference', 'event'."),
  scope: z
    .string()
    .optional()
    .describe(
      "Scope name. Omitted = first scope the calling tool has write access to."
    ),
  tags: z.array(z.string()).optional().describe('Optional tags for later filtering.'),
  source: z.string().optional().describe('Optional source label (e.g. conversation id).'),
};

export function registerRememberTool(server: McpServer, filter: ScopeFilter): void {
  server.registerTool(
    'remember',
    {
      title: 'Remember a fact',
      description:
        "Store a memory (fact, preference, event, note). The memory is scoped to the calling tool's writable scopes. Returns the stored memory id.",
      inputSchema: shape,
    },
    async (args) => {
      try {
        const memory = await filter.remember({
          content: args.content,
          ...(args.kind ? { kind: args.kind } : {}),
          ...(args.scope ? { scope: args.scope } : {}),
          ...(args.tags ? { tags: args.tags } : {}),
          ...(args.source ? { source: args.source } : {}),
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Remembered #${memory.id} in scope '${memory.scope ?? '-'}'.`,
            },
          ],
          structuredContent: {
            id: memory.id,
            scope: memory.scope,
            kind: memory.kind,
            tags: memory.tags,
          },
        };
      } catch (err) {
        return toToolError(err);
      }
    }
  );
}
