import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { AppContext, type ContextInit } from '../core/context.js';
import { AuthError } from '../core/errors.js';
import { DEFAULT_HTTP_HOST, DEFAULT_HTTP_PORT } from '../core/constants.js';
import { hashToken } from '../core/tools/tokens.js';

import { buildServer } from './server.js';
import { ScopeFilter } from './scopeFilter.js';

export interface HttpServeOptions extends ContextInit {
  port?: number;
  host?: string;
  /** Bearer token expected on every request; defaults to DARKCONTEXT_TOKEN env. */
  token?: string;
}

export interface StartedHttpServer {
  httpServer: HttpServer;
  port: number;
  close: () => Promise<void>;
}

/**
 * Start the DarkContext MCP server over Streamable HTTP.
 *
 * Auth model (M3): one process = one tool identity. The process is
 * configured with a single bearer token (via --token / DARKCONTEXT_TOKEN)
 * and rejects requests whose `Authorization: Bearer ...` header does not
 * match in constant time. Multi-tool HTTP with per-request identity is
 * deferred to a future milestone.
 *
 * Any error thrown during setup (missing token, unregistered token,
 * listen failure) closes the context before propagating — no DB leak.
 */
export async function startHttpServer(opts: HttpServeOptions = {}): Promise<StartedHttpServer> {
  const ctx = AppContext.open(opts);
  try {
    const token = opts.token ?? ctx.config.token;
    if (!token) {
      throw new AuthError('HTTP transport requires --token or DARKCONTEXT_TOKEN to be set.');
    }

    const callerTool = ctx.tools.authenticate(token);
    if (!callerTool) {
      throw new AuthError('Provided token does not match any registered tool.');
    }

    const filter = new ScopeFilter(callerTool, {
      memories: ctx.memories,
      documents: ctx.documents,
      workspaces: ctx.workspaces,
      conversations: ctx.conversations,
    });
    const auditor = ctx.newAuditLog(callerTool);
    const mcpServer = buildServer(filter, auditor);

    const transport = new StreamableHTTPServerTransport(
      // Stateless mode: the SDK signals this by omitting a generator function.
      // The type demands a function under exactOptionalPropertyTypes; the
      // runtime accepts `undefined` — cast deliberately.
      { sessionIdGenerator: undefined } as unknown as ConstructorParameters<
        typeof StreamableHTTPServerTransport
      >[0]
    );
    await mcpServer.connect(transport as unknown as Transport);

    const expectedHash = hashToken(token);
    const httpServer = createServer(async (req, res) => {
      if (!checkBearer(req, expectedHash)) return unauthorized(res);
      try {
        await transport.handleRequest(req, res);
      } catch (err) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: (err as Error).message }));
        }
      }
    });

    const port = opts.port ?? DEFAULT_HTTP_PORT;
    const host = opts.host ?? DEFAULT_HTTP_HOST;
    await new Promise<void>((done) => httpServer.listen(port, host, done));
    const address = httpServer.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;

    return {
      httpServer,
      port: actualPort,
      close: async () => {
        await new Promise<void>((done, reject) =>
          httpServer.close((err) => (err ? reject(err) : done()))
        );
        await mcpServer.close();
        ctx.close();
      },
    };
  } catch (err) {
    ctx.close();
    throw err;
  }
}

function checkBearer(req: IncomingMessage, expectedHash: string): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return false;
  const presented = header.slice('Bearer '.length).trim();
  if (!presented) return false;
  const a = Buffer.from(hashToken(presented), 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function unauthorized(res: ServerResponse): void {
  res.statusCode = 401;
  res.setHeader('www-authenticate', 'Bearer realm="darkcontext"');
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: 'unauthorized' }));
}
