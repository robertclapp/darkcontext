import { z } from 'zod';

import { defineTool } from './types.js';

export const searchDocumentsTool = defineTool({
  name: 'search_documents',
  title: 'Search documents',
  description:
    'Search ingested documents by semantic similarity over chunks. Returns matching chunks with document title and offset so the caller can cite the source.',
  inputSchema: {
    query: z.string().min(1).describe('Natural-language query to search documents for.'),
    scope: z.string().optional().describe('Restrict to a scope (must be readable).'),
    limit: z.number().int().positive().max(25).optional().describe('Max chunks (default 10).'),
  },
  async handler(args, { filter }) {
    const hits = await filter.searchDocuments(args.query, {
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(args.scope ? { scope: args.scope } : {}),
    });
    if (hits.length === 0) {
      return {
        content: [{ type: 'text', text: 'No matching document chunks.' }],
        structuredContent: { hits: [] },
      };
    }
    const lines = hits.map(
      (h) => `[${h.match} ${h.score.toFixed(3)}] ${h.title} [${h.scope ?? '-'}] #${h.chunkIdx}\n${h.content}`
    );
    return {
      content: [{ type: 'text', text: lines.join('\n\n') }],
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
  },
});
