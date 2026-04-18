import { defineTool } from './types.js';

export const getActiveWorkspaceTool = defineTool({
  name: 'get_active_workspace',
  title: 'Get the active workspace',
  description:
    'Return the currently active workspace if the calling tool can read it; null otherwise.',
  inputSchema: {},
  handler(_args, { filter }) {
    const active = filter.getActiveWorkspace();
    return {
      content: [
        {
          type: 'text',
          text: active ? `${active.name} [${active.scope ?? '-'}]` : '(no active workspace)',
        },
      ],
      structuredContent: { workspace: active },
    };
  },
});
