import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ScopeFilter } from '../scopeFilter.js';
import { withAudit } from '../audit.js';
import type { AuditSink } from '../../core/audit/index.js';
import type { ToolWithGrants } from '../../core/tools/index.js';

const shape = {
  query: z.string().min(1).describe('Natural-language query to search documents for.'),
  scope: z.string().optional().describe('Restrict to a scope (must be readable).'),
  limit: z.number().int().positive().max(25).optional().describe('Max chunks (default 10).'),
};

export function registerSearchDocumentsTool(
  server: McpServer,
  filter: ScopeFilter,
  auditor: AuditSink,
  caller: ToolWithGrants
): void {
  server.registerTool(
    'search_documents',
    {
      title: 'Search documents',
      description:
        'Search ingested documents by semantic similarity over chunks. Returns matching chunks with document title and offset so the caller can cite the source.',
      inputSchema: shape,
    },
    withAudit(auditor, caller, 'search_documents', async (args) => {
      const hits = await filter.searchDocuments(args.query, {
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.scope ? { scope: args.scope } : {}),
      });
      if (hits.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No matching document chunks.' }],
          structuredContent: { hits: [] },
        };
      }
      const lines = hits.map(
        (h) => `[${h.match} ${h.score.toFixed(3)}] ${h.title} [${h.scope ?? '-'}] #${h.chunkIdx}\n${h.content}`
      );
      return {
        content: [{ type: 'text' as const, text: lines.join('\n\n') }],
        structuredContent: {
          hits: hits.map((h) => ({
            documentId: h.documentId,
            title: h.title,
            scope: h.scope,
            chunkIdx: h.chunkIdx,
            content: h.content,
            score: h.score,
            match: h.match,
          })),
        },
      };
    })
  );
}
