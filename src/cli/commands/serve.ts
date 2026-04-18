import type { Command } from 'commander';

import { startStdioServer } from '../../mcp/server.js';

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('Run the DarkContext MCP server (stdio transport)')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .option('--stdio', 'use stdio transport (default; currently the only supported transport)', true)
    .action(async (opts: { db?: string; provider?: string; stdio?: boolean }) => {
      const started = await startStdioServer({
        ...(opts.db ? { dbPath: opts.db } : {}),
        ...(opts.provider ? { provider: opts.provider } : {}),
      });

      const shutdown = async () => {
        await started.close();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);

      // MCP server runs until stdin closes; stderr-log that we're live so
      // operators can confirm the process started without interfering with
      // the stdio protocol on stdout.
      process.stderr.write(
        `darkcontext: serving as '${started.filter.callerName}' ` +
          `(scopes: ${started.filter.readableScopes().join(', ') || 'none'})\n`
      );
    });
}
