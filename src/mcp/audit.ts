import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { AuditSink } from '../core/audit/index.js';
import { redactArgs } from '../core/audit/index.js';
import type { ToolWithGrants } from '../core/tools/index.js';

import { ScopeDeniedError } from './scopeFilter.js';

/**
 * Wrap an MCP tool handler with audit logging AND uniform error handling.
 *
 * Handlers return a success-shaped `CallToolResult`. They do not need to
 * catch exceptions — this wrapper:
 *
 *  - Classifies the outcome by exception type (not string-matching):
 *    `ScopeDeniedError` → `denied`, any other throw → `error`.
 *  - Converts denials and unexpected errors to `isError: true` tool
 *    results, so the MCP client sees a tool error, not a protocol error.
 *  - Redacts private content fields (see core/audit/audit.ts) before
 *    writing the audit row.
 *
 * This centralizes all three concerns — audit, error classification, and
 * error presentation — in one place so tool handlers stay focused on
 * their happy path.
 */
export function withAudit<TArgs>(
  auditor: AuditSink,
  callerTool: ToolWithGrants,
  mcpToolName: string,
  handler: (args: TArgs) => CallToolResult | Promise<CallToolResult>
): (args: TArgs) => Promise<CallToolResult> {
  return async (args: TArgs) => {
    const start = Date.now();
    let outcome: 'ok' | 'denied' | 'error' = 'ok';
    let errorMessage: string | null = null;
    let result: CallToolResult;
    try {
      result = await handler(args);
    } catch (err) {
      if (err instanceof ScopeDeniedError) {
        outcome = 'denied';
        errorMessage = err.message;
        result = {
          isError: true,
          content: [{ type: 'text', text: `permission denied: ${err.message}` }],
        };
      } else {
        outcome = 'error';
        errorMessage = err instanceof Error ? err.message : String(err);
        result = {
          isError: true,
          content: [{ type: 'text', text: errorMessage }],
        };
      }
    }

    auditor.record({
      ts: start,
      toolId: callerTool.id,
      toolName: callerTool.name,
      mcpTool: mcpToolName,
      args: redactArgs(args),
      outcome,
      error: errorMessage,
      durationMs: Date.now() - start,
    });
    return result;
  };
}
