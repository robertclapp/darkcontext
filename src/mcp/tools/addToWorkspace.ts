import { z } from 'zod';

import { defineTool } from './types.js';

export const addToWorkspaceTool = defineTool({
  name: 'add_to_workspace',
  title: 'Add an item to a workspace',
  description:
    "Attach an item (kind: 'task', 'goal', 'note', 'thread', ...) to a workspace. If workspaceId is omitted, the active workspace is used.",
  inputSchema: {
    kind: z.string().min(1).describe("Item kind: task, goal, note, thread, etc."),
    content: z.string().min(1).describe('Item body.'),
    workspaceId: z.number().int().positive().optional().describe('Target workspace id; defaults to active.'),
    state: z.string().optional().describe("Lifecycle state (default 'open')."),
  },
  handler(args, { filter }) {
    const item = filter.addToWorkspace({
      kind: args.kind,
      content: args.content,
      ...(args.workspaceId !== undefined ? { workspaceId: args.workspaceId } : {}),
      ...(args.state ? { state: args.state } : {}),
    });
    return {
      content: [
        {
          type: 'text',
          text: `Added ${item.kind} #${item.id} to workspace ${item.workspaceId}.`,
        },
      ],
      structuredContent: { item },
    };
  },
});
