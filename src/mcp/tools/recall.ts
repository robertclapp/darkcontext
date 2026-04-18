import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ScopeFilter } from '../scopeFilter.js';
import { withAudit } from '../audit.js';
import type { AuditSink } from '../../core/audit/index.js';
import type { ToolWithGrants } from '../../core/tools/index.js';

const shape = {
  query: z.string().min(1).describe('Natural-language query to search memories for.'),
  scope: z
    .string()
    .optional()
    .describe('Restrict to a specific scope (must be readable by the calling tool).'),
  limit: z.number().int().positive().max(50).optional().describe('Max number of hits (default 10, max 50).'),
};

export function registerRecallTool(
  server: McpServer,
  filter: ScopeFilter,
  auditor: AuditSink,
  caller: ToolWithGrants
): void {
  server.registerTool(
    'recall',
    {
      title: 'Recall memories',
      description:
        'Search stored memories by semantic similarity (falls back to keyword when vector search is unavailable). Results are filtered to scopes the calling tool can read.',
      inputSchema: shape,
    },
    withAudit(auditor, caller, 'recall', async (args) => {
      const hits = await filter.recall(args.query, {
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.scope ? { scope: args.scope } : {}),
      });
      if (hits.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No matching memories.' }],
          structuredContent: { hits: [] },
        };
      }
      const lines = hits.map(
        (h) =>
          `#${h.memory.id} [${h.memory.scope ?? '-'}] (${h.match} ${h.score.toFixed(3)}) ${h.memory.content}`
      );
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
        structuredContent: {
          hits: hits.map((h) => ({
            id: h.memory.id,
            content: h.memory.content,
            scope: h.memory.scope,
            tags: h.memory.tags,
            kind: h.memory.kind,
            score: h.score,
            match: h.match,
          })),
        },
      };
    })
  );
}
