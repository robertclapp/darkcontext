import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ScopeFilter } from '../scopeFilter.js';
import { toToolError } from './errors.js';

const shape = {
  query: z.string().min(1).describe('Natural-language query to search past conversations for.'),
  scope: z.string().optional().describe('Restrict to a scope (must be readable).'),
  source: z.string().optional().describe("Filter by source (e.g. 'chatgpt', 'claude', 'gemini', 'generic')."),
  limit: z.number().int().positive().max(50).optional().describe('Max messages (default 10).'),
};

export function registerSearchHistoryTool(server: McpServer, filter: ScopeFilter): void {
  server.registerTool(
    'search_history',
    {
      title: 'Search conversation history',
      description:
        'Search across imported conversations (ChatGPT, Claude, Gemini, generic). Returns individual matching messages with the conversation title and timestamp so the caller can cite the source.',
      inputSchema: shape,
    },
    async (args) => {
      try {
        const hits = await filter.searchHistory(args.query, {
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
          ...(args.scope ? { scope: args.scope } : {}),
          ...(args.source ? { source: args.source } : {}),
        });
        if (hits.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No matching history.' }],
            structuredContent: { hits: [] },
          };
        }
        const lines = hits.map((h) => {
          const when = new Date(h.ts).toISOString();
          return `[${h.match} ${h.score.toFixed(3)}] ${h.source}/${h.title} (${when}) <${h.role}> ${h.content}`;
        });
        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
          structuredContent: {
            hits: hits.map((h) => ({
              conversationId: h.conversationId,
              source: h.source,
              title: h.title,
              scope: h.scope,
              messageId: h.messageId,
              role: h.role,
              content: h.content,
              ts: h.ts,
              score: h.score,
              match: h.match,
            })),
          },
        };
      } catch (err) {
        return toToolError(err);
      }
    }
  );
}
