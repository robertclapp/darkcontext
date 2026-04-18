import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { AuditSink } from '../core/audit/index.js';
import { redactArgs } from '../core/audit/index.js';
import type { ToolWithGrants } from '../core/tools/index.js';

/**
 * Wrap an MCP tool handler with audit logging. Every invocation produces an
 * audit row containing the calling tool id, mcp tool name, redacted args,
 * and outcome (ok | denied | error). Redaction strips private content bodies
 * (see core/audit/audit.ts CONTENT_KEYS) — audit should not become a shadow
 * copy of user data.
 *
 * `denied` is distinguished from `error` when the handler returns a tool
 * error whose message starts with "permission denied" — that's the shape
 * ScopeDeniedError produces via toToolError(). Unknown errors are `error`.
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
      if (result.isError) {
        const text = firstText(result);
        outcome = text.startsWith('permission denied') ? 'denied' : 'error';
        errorMessage = text;
      }
    } catch (err) {
      outcome = 'error';
      errorMessage = (err as Error).message;
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
      throw err;
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

function firstText(result: CallToolResult): string {
  if (!Array.isArray(result.content)) return '';
  const first = result.content[0];
  if (first && 'text' in first && typeof first.text === 'string') return first.text;
  return '';
}
