import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { Memories } from '../core/memories/index.js';
import { Documents } from '../core/documents/index.js';
import { Workspaces } from '../core/workspace/index.js';
import { Tools } from '../core/tools/index.js';
import { createEmbeddingProvider, resolveProviderKind } from '../core/embeddings/index.js';
import { openDb } from '../core/store/db.js';
import { hashToken } from '../core/tools/tokens.js';

import { buildServer } from './server.js';
import { ScopeFilter } from './scopeFilter.js';

export interface HttpServeOptions {
  dbPath?: string;
  provider?: string;
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
 * Auth model (M3): one process = one tool identity. The process is configured
 * with a single bearer token (via --token or DARKCONTEXT_TOKEN) and rejects
 * requests whose `Authorization: Bearer ...` header does not match in
 * constant time. Multi-tool HTTP with per-request identity is deferred to M5.
 */
export async function startHttpServer(opts: HttpServeOptions = {}): Promise<StartedHttpServer> {
  const token = opts.token ?? process.env.DARKCONTEXT_TOKEN;
  if (!token) {
    throw new Error('HTTP transport requires --token or DARKCONTEXT_TOKEN to be set.');
  }

  const db = openDb(opts.dbPath ? { path: opts.dbPath } : {});
  const embeddings = createEmbeddingProvider(resolveProviderKind(opts.provider));
  const memories = new Memories(db, embeddings);
  const documents = new Documents(db, embeddings);
  const workspaces = new Workspaces(db);
  const toolsStore = new Tools(db);

  const callerTool = toolsStore.authenticate(token);
  if (!callerTool) {
    db.close();
    throw new Error('Provided token does not match any registered tool.');
  }

  const filter = new ScopeFilter(callerTool, { memories, documents, workspaces });
  const mcpServer = buildServer(filter);
  // Stateless mode: the SDK signals this by the generator being absent.
  // The type demands a function under exactOptionalPropertyTypes; the runtime
  // accepts `undefined` — cast deliberately.
  const transport = new StreamableHTTPServerTransport(
    { sessionIdGenerator: undefined } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]
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

  const port = opts.port ?? 4000;
  const host = opts.host ?? '127.0.0.1';

  await new Promise<void>((resolvePromise) => httpServer.listen(port, host, resolvePromise));
  const address = httpServer.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    httpServer,
    port: actualPort,
    close: async () => {
      await new Promise<void>((resolvePromise, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolvePromise()))
      );
      await mcpServer.close();
      db.close();
    },
  };
}

function checkBearer(req: IncomingMessage, expectedHash: string): boolean {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return false;
  const presented = header.slice('Bearer '.length).trim();
  if (!presented) return false;
  const presentedHash = hashToken(presented);
  const a = Buffer.from(presentedHash, 'hex');
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
