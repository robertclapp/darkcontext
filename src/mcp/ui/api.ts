import type { IncomingMessage, ServerResponse } from 'node:http';

import type { ScopeFilter } from '../scopeFilter.js';

/**
 * JSON API powering the read-only Web UI. Every endpoint routes through
 * the same `ScopeFilter` the MCP tools use, so the UI can never show a
 * tool more than the tool can already see via MCP.
 *
 * Read-only by design: no mutating endpoints. Adding writes (e.g.
 * `forget`, `remember`) would require CSRF protection because the UI
 * runs in a browser; right now there's nothing for an attacker who
 * tricks the operator's browser to actually do.
 */

interface RouteCtx {
  url: URL;
  filter: ScopeFilter;
}

type Handler = (ctx: RouteCtx) => Promise<unknown> | unknown;

const ROUTES: Record<string, Handler> = {
  '/ui/api/identity': identity,
  '/ui/api/recall': recall,
  '/ui/api/documents/search': searchDocuments,
  '/ui/api/history': searchHistory,
  '/ui/api/workspaces': listWorkspaces,
};

/**
 * Any path under `/ui/api/` is owned by this module — even unknown
 * subpaths get a 404 from us rather than falling through to the MCP
 * transport (which would return 406 because it expects a specific
 * Accept header). Keeps error responses predictable for the UI.
 */
export function isUiApiPath(pathname: string): boolean {
  return pathname === '/ui/api' || pathname.startsWith('/ui/api/');
}

export async function handleUiApi(
  req: IncomingMessage,
  res: ServerResponse,
  filter: ScopeFilter
): Promise<void> {
  // Build a URL from the request — `req.url` is path+query only, so we
  // pair it with a dummy origin for `URL` parsing. The origin is never
  // exposed; only `pathname` and `searchParams` matter.
  const url = new URL(req.url ?? '/', 'http://x');
  const handler = ROUTES[url.pathname];
  if (!handler) {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  if (req.method && req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('content-type', 'application/json');
    res.setHeader('allow', 'GET');
    res.end(JSON.stringify({ error: 'method not allowed (read-only API)' }));
    return;
  }
  try {
    const body = await handler({ url, filter });
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  } catch (err) {
    // Echo the message but not the stack — error messages from
    // ScopeFilter are operator-friendly ("permission denied: ...") and
    // the operator is the only legitimate client.
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: (err as Error).message ?? String(err) }));
  }
}

// ---------- handlers ----------

function identity({ filter }: RouteCtx): unknown {
  const tool = filter.caller;
  return {
    tool: tool.name,
    scopes: tool.grants.map((g) => ({
      scope: g.scope,
      canRead: g.canRead,
      canWrite: g.canWrite,
    })),
  };
}

async function recall({ url, filter }: RouteCtx): Promise<unknown> {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return { hits: [] };
  const opts = parseSearchOpts(url, 50);
  const hits = await filter.recall(q, opts);
  return {
    hits: hits.map((h) => ({
      id: h.memory.id,
      content: h.memory.content,
      scope: h.memory.scope,
      kind: h.memory.kind,
      tags: h.memory.tags,
      score: h.score,
      match: h.match,
    })),
  };
}

async function searchDocuments({ url, filter }: RouteCtx): Promise<unknown> {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return { hits: [] };
  const opts = parseSearchOpts(url, 25);
  const hits = await filter.searchDocuments(q, opts);
  return {
    hits: hits.map((h) => ({
      documentId: h.documentId,
      title: h.title,
      scope: h.scope,
      chunkIdx: h.chunkIdx,
      content: h.content,
      score: h.score,
      match: h.match,
    })),
  };
}

async function searchHistory({ url, filter }: RouteCtx): Promise<unknown> {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return { hits: [] };
  const opts = parseSearchOpts(url, 50);
  const source = url.searchParams.get('source')?.trim();
  const hits = await filter.searchHistory(q, {
    ...opts,
    ...(source ? { source } : {}),
  });
  return {
    hits: hits.map((h) => ({
      conversationId: h.conversationId,
      source: h.source,
      title: h.title,
      scope: h.scope,
      messageId: h.messageId,
      role: h.role,
      content: h.content,
      ts: h.ts,
      score: h.score,
      match: h.match,
    })),
  };
}

function listWorkspaces({ filter }: RouteCtx): unknown {
  return {
    workspaces: filter.listWorkspaces().map((w) => ({
      id: w.id,
      name: w.name,
      isActive: w.isActive,
      scope: w.scope,
      createdAt: w.createdAt,
    })),
  };
}

// ---------- helpers ----------

function parseSearchOpts(url: URL, maxLimit: number): { limit?: number; scope?: string } {
  const out: { limit?: number; scope?: string } = {};
  const scope = url.searchParams.get('scope')?.trim();
  if (scope) out.scope = scope;
  const limitRaw = url.searchParams.get('limit');
  if (limitRaw !== null) {
    const n = Number(limitRaw);
    if (Number.isFinite(n) && n > 0) {
      out.limit = Math.min(Math.floor(n), maxLimit);
    }
  }
  return out;
}
