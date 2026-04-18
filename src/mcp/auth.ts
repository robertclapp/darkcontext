import type { Tools, ToolWithGrants } from '../core/tools/index.js';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Resolve the calling tool identity from `DARKCONTEXT_TOKEN`. For the stdio
 * transport there are no HTTP headers, so the token arrives via env. The
 * process runs as a single tool identity for its lifetime — Claude Desktop
 * spawns one MCP server per configured tool, which matches this model.
 */
export function resolveToolFromEnv(
  tools: Tools,
  env: NodeJS.ProcessEnv = process.env
): ToolWithGrants {
  const token = env.DARKCONTEXT_TOKEN;
  if (!token) {
    throw new AuthError(
      'DARKCONTEXT_TOKEN is not set. Run `dcx tool add <name> --scopes ...` to provision one.'
    );
  }
  const tool = tools.authenticate(token);
  if (!tool) {
    throw new AuthError('DARKCONTEXT_TOKEN did not match any registered tool.');
  }
  return tool;
}
