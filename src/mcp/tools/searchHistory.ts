import { z } from 'zod';

import { defineTool } from './types.js';

export const searchHistoryTool = defineTool({
  name: 'search_history',
  title: 'Search conversation history',
  description:
    'Search across imported conversations (ChatGPT, Claude, Gemini, generic). Returns individual matching messages with the conversation title and timestamp so the caller can cite the source.',
  inputSchema: {
    query: z.string().min(1).describe('Natural-language query to search past conversations for.'),
    scope: z.string().optional().describe('Restrict to a scope (must be readable).'),
    source: z.string().optional().describe("Filter by source (e.g. 'chatgpt', 'claude', 'gemini', 'generic')."),
    limit: z.number().int().positive().max(50).optional().describe('Max messages (default 10).'),
  },
  async handler(args, { filter }) {
    const hits = await filter.searchHistory(args.query, {
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(args.scope ? { scope: args.scope } : {}),
      ...(args.source ? { source: args.source } : {}),
    });
    if (hits.length === 0) {
      return {
        content: [{ type: 'text', text: 'No matching history.' }],
        structuredContent: { hits: [] },
      };
    }
    const lines = hits.map((h) => {
      const when = new Date(h.ts).toISOString();
      return `[${h.match} ${h.score.toFixed(3)}] ${h.source}/${h.title} (${when}) <${h.role}> ${h.content}`;
    });
    return {
      content: [{ type: 'text', text: lines.join('\n') }],
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
  },
});
