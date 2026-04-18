import { z } from 'zod';

import { defineTool } from './types.js';

export const rememberTool = defineTool({
  name: 'remember',
  title: 'Remember a fact',
  description:
    "Store a memory (fact, preference, event, note). The memory is scoped to the calling tool's writable scopes. Returns the stored memory id.",
  inputSchema: {
    content: z.string().min(1).describe('The fact, preference, or note to remember.'),
    kind: z.string().optional().describe("Category (default 'fact'); e.g. 'preference', 'event'."),
    scope: z
      .string()
      .optional()
      .describe("Scope name. Omitted = first scope the calling tool has write access to."),
    tags: z.array(z.string()).optional().describe('Optional tags for later filtering.'),
    source: z.string().optional().describe('Optional source label (e.g. conversation id).'),
  },
  async handler(args, { filter }) {
    const memory = await filter.remember({
      content: args.content,
      ...(args.kind ? { kind: args.kind } : {}),
      ...(args.scope ? { scope: args.scope } : {}),
      ...(args.tags ? { tags: args.tags } : {}),
      ...(args.source ? { source: args.source } : {}),
    });
    return {
      content: [
        { type: 'text', text: `Remembered #${memory.id} in scope '${memory.scope ?? '-'}'.` },
      ],
      structuredContent: {
        id: memory.id,
        scope: memory.scope,
        kind: memory.kind,
        tags: memory.tags,
      },
    };
  },
});
