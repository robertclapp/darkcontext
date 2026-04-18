import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
 * Auth model: one process = one tool identity. The process is
 * configured with a single bearer token (via --token / DARKCONTEXT_TOKEN)
 * and rejects requests whose `Authorization: Bearer ...` header does not
 * match in constant time. Multi-tool HTTP with per-request identity is
 * deferred to a future milestone.
 *
 * Any error thrown during setup (missing token, unregistered token,
 * listen failure) closes every opened resource — context, MCP server,
 * transport — before propagating, so no DB or socket handle leaks.
 */
export async function startHttpServer(opts: HttpServeOptions = {}): Promise<StartedHttpServer> {
  const ctx = AppContext.open(opts);
  let mcpServer: McpServer | undefined;
  let transport: StreamableHTTPServerTransport | undefined;
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
    mcpServer = buildServer(filter, auditor);

    transport = new StreamableHTTPServerTransport(
      // Stateless mode: the SDK signals this by omitting a generator function.
      // The type demands a function under exactOptionalPropertyTypes; the
      // runtime accepts `undefined` — cast deliberately.
      { sessionIdGenerator: undefined } as unknown as ConstructorParameters<
        typeof StreamableHTTPServerTransport
      >[0]
    );
    await mcpServer.connect(transport as unknown as Transport);

    const expectedHash = hashToken(token);
    const boundTransport = transport;
    const httpServer = createServer(async (req, res) => {
      if (!checkBearer(req, expectedHash)) return unauthorized(res);
      try {
        await boundTransport.handleRequest(req, res);
      } catch (err) {
        // Do NOT reflect raw error text to clients — messages may contain
        // file paths, SQL fragments, or stack traces. Log server-side for
        // operators, send a generic response to the wire. Errors thrown
        // after headers have flushed can't produce a response body; still
        // log them so they aren't swallowed.
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json');
          console.error('[darkcontext http] request failed:', err);
          res.end(JSON.stringify({ error: 'internal server error' }));
        } else {
          console.error('[darkcontext http] error after headers sent:', err);
        }
      }
    });

    const port = opts.port ?? DEFAULT_HTTP_PORT;
    const host = opts.host ?? DEFAULT_HTTP_HOST;
    // `listen()` calls the success callback on bind success and emits an
    // `'error'` event on failure (EADDRINUSE, EACCES, ...). Without a
    // listener, that event crashes the process AND escapes the outer
    // try/catch that would have closed the AppContext. Race the two so
    // the startup path surfaces a typed error that the caller can handle.
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const onError = (err: Error): void => {
        httpServer.off('listening', onListening);
        rejectPromise(err);
      };
      const onListening = (): void => {
        httpServer.off('error', onError);
        resolvePromise();
      };
      httpServer.once('error', onError);
      httpServer.once('listening', onListening);
      httpServer.listen(port, host);
    });
    const address = httpServer.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;

    return {
      httpServer,
      port: actualPort,
      close: async () => {
        // Four independent resources to unwind: HTTP listener, MCP
        // server, Streamable-HTTP transport, and AppContext. Each close
        // can throw independently. We attempt ALL of them, remembering
        // the first failure for re-throw at the end so a later cleanup
        // failure can't mask the real one. ctx.close() always runs —
        // the DB handle must not leak even if every other teardown
        // errored.
        let primaryErr: unknown;
        try {
          await new Promise<void>((done, reject) =>
            httpServer.close((err) => (err ? reject(err) : done()))
          );
        } catch (err) {
          primaryErr = err;
        }
        try {
          if (mcpServer) await mcpServer.close();
        } catch (err) {
          primaryErr ??= err;
        }
        try {
          await closeTransport(transport);
        } catch (err) {
          primaryErr ??= err;
        }
        try {
          ctx.close();
        } catch (err) {
          primaryErr ??= err;
        }
        if (primaryErr) throw primaryErr;
      },
    };
  } catch (err) {
    // Startup failure path: tear down anything we successfully opened
    // before the throw, in reverse order, and swallow secondary errors
    // so the primary (the actual cause) propagates.
    try {
      await closeTransport(transport);
    } catch {
      /* best-effort */
    }
    if (mcpServer) {
      try {
        await mcpServer.close();
      } catch {
        /* best-effort */
      }
    }
    ctx.close();
    throw err;
  }
}

/**
 * The SDK's transport types don't explicitly document a `close()` in
 * every version; call it only if present. This keeps us forward-
 * compatible without pinning to an SDK shape we don't own.
 */
async function closeTransport(transport: StreamableHTTPServerTransport | undefined): Promise<void> {
  if (!transport) return;
  const fn = (transport as { close?: () => Promise<void> | void }).close;
  if (typeof fn === 'function') await fn.call(transport);
}

function checkBearer(req: IncomingMessage, expectedHash: string): boolean {
  const header = req.headers.authorization;
  if (!header) return false;
  // RFC 7235 defines authentication schemes as case-insensitive. Accept
  // any casing of "Bearer" so clients that send `authorization: bearer …`
  // aren't silently rejected as unauthenticated.
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const presented = match[1]!.trim();
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
