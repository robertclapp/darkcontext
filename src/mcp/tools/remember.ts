import { z } from 'zod';

import { defineTool } from './types.js';

export const rememberTool = defineTool({
  name: 'remember',
  title: 'Remember a fact',
  description:
    "Store a memory (fact, preference, event, note). The memory is scoped to the calling tool's writable scopes. Returns the stored memory id.",
  inputSchema: {
    content: z.string().trim().min(1).describe('The fact, preference, or note to remember.'),
    kind: z.string().trim().min(1).optional().describe("Category (default 'fact'); e.g. 'preference', 'event'."),
    scope: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Scope name. Omitted = first scope the calling tool has write access to."),
    tags: z.array(z.string()).optional().describe('Optional tags for later filtering.'),
    source: z.string().trim().min(1).optional().describe('Optional source label (e.g. conversation id).'),
  },
  async handler(args, { filter }) {
    // Use explicit `!== undefined` checks so a deliberate value that
    // Zod reduces to something falsy (not possible here given the .min(1)
    // constraints, but a future schema loosen-up should not silently
    // change routing) doesn't collapse back into the default.
    const memory = await filter.remember({
      content: args.content,
      ...(args.kind !== undefined ? { kind: args.kind } : {}),
      ...(args.scope !== undefined ? { scope: args.scope } : {}),
      ...(args.tags !== undefined ? { tags: args.tags } : {}),
      ...(args.source !== undefined ? { source: args.source } : {}),
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
