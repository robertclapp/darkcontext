import { z } from 'zod';

import { defineTool } from './types.js';

export const forgetTool = defineTool({
  name: 'forget',
  title: 'Forget a memory',
  description:
    "Delete a memory by id. Silently no-ops if the memory does not exist or is outside the calling tool's writable scopes (to avoid leaking existence).",
  inputSchema: {
    id: z.number().int().positive().describe('Memory id to delete.'),
  },
  handler(args, { filter }) {
    const ok = filter.forget(args.id);
    return {
      content: [
        { type: 'text', text: ok ? `Forgot #${args.id}.` : `No memory with id ${args.id}.` },
      ],
      structuredContent: { deleted: ok, id: args.id },
    };
  },
});
