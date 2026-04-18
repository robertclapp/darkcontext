import { defineTool } from './types.js';

export const listWorkspacesTool = defineTool({
  name: 'list_workspaces',
  title: 'List workspaces',
  description: 'List workspaces the calling tool can read.',
  inputSchema: {},
  handler(_args, { filter }) {
    const workspaces = filter.listWorkspaces();
    const lines = workspaces.map(
      (w) => `${w.isActive ? '* ' : '  '}${w.name} [${w.scope ?? '-'}]`
    );
    return {
      content: [
        {
          type: 'text',
          text: workspaces.length === 0 ? '(no workspaces)' : lines.join('\n'),
        },
      ],
      structuredContent: { workspaces },
    };
  },
});
