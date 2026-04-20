import { z } from 'zod';

import { defineTool } from './types.js';

export const summarizeTool = defineTool({
  name: 'summarize',
  title: 'Summarize history',
  description:
    "LLM-summarize conversation history relevant to a topic. Requires an explicit scope. Optionally persists the summary as a memory in the same scope (writable access required for that).",
  inputSchema: {
    topic: z.string().trim().min(1).describe('The topic to summarize.'),
    scope: z
      .string()
      .trim()
      .min(1)
      .describe('Scope to read history from (must be readable; required — see SECURITY.md).'),
    source: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Restrict to one importer source: 'chatgpt' | 'claude' | 'gemini' | 'generic'."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Number of history messages to feed the LLM (default 20, max 100).'),
    save: z
      .boolean()
      .optional()
      .describe('Persist the summary as a memory in the same scope (kind=summary). Requires write access.'),
  },
  async handler(args, { filter }) {
    const result = await filter.summarizeHistoryViaLLM({
      topic: args.topic,
      scope: args.scope,
      ...(args.source !== undefined ? { source: args.source } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
      ...(args.save !== undefined ? { save: args.save } : {}),
    });
    return {
      content: [
        { type: 'text', text: result.summary },
      ],
      structuredContent: {
        topic: result.topic,
        scope: result.scope,
        source: result.source,
        sourceCount: result.sourceCount,
        savedMemoryId: result.savedMemoryId,
        provider: result.provider,
      },
    };
  },
});
