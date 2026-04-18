import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShape, z } from 'zod';

import type { ScopeFilter } from '../scopeFilter.js';

/**
 * Runtime context passed into every MCP tool handler.
 *
 * Today that's just the scope-filtered domain access. Future hooks
 * (tracing span, feature flags, request id) would go here so handlers
 * never reach out to module-level globals.
 */
export interface McpToolContext {
  readonly filter: ScopeFilter;
}

/**
 * A declarative MCP tool: a pure description of `name + schema + handler`.
 *
 * Each tool lives in its own file and exports exactly one `McpToolDef`.
 * The registry (`registry.ts`) aggregates them and hands each to
 * `withAudit(...)` + `server.registerTool(...)`.
 *
 * Why not register-by-side-effect functions? Tools as data let us:
 *   - enumerate the full surface in a single place (the registry array)
 *   - test handlers in isolation without spinning up an McpServer
 *   - derive docs from the same definitions
 */
export interface McpToolDef<TShape extends ZodRawShape = ZodRawShape> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: TShape;
  readonly annotations?: ToolAnnotations;
  handler(
    args: z.infer<z.ZodObject<TShape>>,
    ctx: McpToolContext
  ): Promise<CallToolResult> | CallToolResult;
}

/**
 * Preserves the Zod input-shape type on a per-tool basis so handlers get
 * fully inferred `args`. The registry erases the generic down to
 * `McpToolDef` when aggregating — safe because Zod validates at runtime.
 */
export function defineTool<TShape extends ZodRawShape>(def: McpToolDef<TShape>): McpToolDef<TShape> {
  return def;
}
