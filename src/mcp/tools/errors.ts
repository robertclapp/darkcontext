import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { ScopeDeniedError } from '../scopeFilter.js';

export function toToolError(err: unknown): CallToolResult {
  const message =
    err instanceof ScopeDeniedError
      ? `permission denied: ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}
