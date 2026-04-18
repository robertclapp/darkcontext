import type { Command } from 'commander';

import { startStdioServer } from '../../mcp/server.js';
import { startHttpServer } from '../../mcp/httpServer.js';

export function registerServe(program: Command): void {
  program
    .command('serve')
    .description('Run the DarkContext MCP server (stdio by default, --http for HTTP)')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .option('--http', 'use HTTP (Streamable HTTP) transport instead of stdio')
    .option('--port <port>', 'HTTP port (default 4000)', (v) => Number(v), 4000)
    .option('--host <host>', 'HTTP bind host (default 127.0.0.1)', '127.0.0.1')
    .option('--token <token>', 'HTTP bearer token (defaults to DARKCONTEXT_TOKEN env)')
    .action(
      async (opts: {
        db?: string;
        provider?: string;
        http?: boolean;
        port: number;
        host: string;
        token?: string;
      }) => {
        if (opts.http) {
          const started = await startHttpServer({
            ...(opts.db ? { dbPath: opts.db } : {}),
            ...(opts.provider ? { provider: opts.provider } : {}),
            port: opts.port,
            host: opts.host,
            ...(opts.token ? { token: opts.token } : {}),
          });
          process.stderr.write(
            `darkcontext: listening on http://${opts.host}:${started.port}/mcp (bearer auth required)\n`
          );
          const shutdown = async () => {
            await started.close();
            process.exit(0);
          };
          process.on('SIGINT', shutdown);
          process.on('SIGTERM', shutdown);
          return;
        }

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
        process.stderr.write(
          `darkcontext: serving as '${started.filter.callerName}' ` +
            `(scopes: ${started.filter.readableScopes().join(', ') || 'none'})\n`
        );
      }
    );
}
