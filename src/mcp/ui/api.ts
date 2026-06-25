import type { IncomingMessage, ServerResponse } from 'node:http';

import type { AuditSink } from '../../core/audit/index.js';
import { redactArgs } from '../../core/audit/index.js';
import { ScopeDeniedError, ValidationError } from '../../core/errors.js';
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
 *
 * Every request is recorded in the audit log with `mcpTool: 'ui:<route>'`
 * — the UI shares the bearer with the MCP transport, so the audit trail
 * needs to attribute UI reads to the same identity (otherwise UI access
 * is an invisible side channel around the tool-level audit).
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

/** Add the response headers every UI-API reply must carry:
 *  - `content-type: application/json` (uniform JSON contract)
 *  - `cache-control: no-store` so browser/intermediary caches never
 *    persist scope-filtered data. Without this a back-button replay
 *    or shared cache could leak hits from a previous session. */
function setUiHeaders(res: ServerResponse): void {
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
}

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
  filter: ScopeFilter,
  auditor: AuditSink
): Promise<void> {
  // Build a URL from the request — `req.url` is path+query only, so we
  // pair it with a dummy origin for `URL` parsing. The origin is never
  // exposed; only `pathname` and `searchParams` matter.
  const url = new URL(req.url ?? '/', 'http://x');
  const handler = ROUTES[url.pathname];
  if (!handler) {
    res.statusCode = 404;
    setUiHeaders(res);
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }
  if (req.method && req.method !== 'GET') {
    res.statusCode = 405;
    setUiHeaders(res);
    res.setHeader('allow', 'GET');
    res.end(JSON.stringify({ error: 'method not allowed (read-only API)' }));
    return;
  }

  // Record every UI-API call under the same audit sink that wraps MCP
  // tool calls. mcpTool is namespaced `ui:<path>` so operators can tell
  // browser activity apart from agent activity in the audit log, while
  // the toolId/toolName still points at the bearer-authenticated
  // identity. Args are the searchParams (redacted) — never the response.
  const start = Date.now();
  const caller = filter.caller;
  const mcpTool = `ui:${url.pathname.replace(/^\/ui\/api\//, '')}`;
  const args = Object.fromEntries(url.searchParams.entries());
  let outcome: 'ok' | 'denied' | 'error' = 'ok';
  let errorMessage: string | null = null;
  try {
    const body = await handler({ url, filter });
    res.statusCode = 200;
    setUiHeaders(res);
    res.end(JSON.stringify(body));
  } catch (err) {
    // A scope denial gets a generic 403 — we deliberately do NOT echo the
    // ScopeFilter message ("tool 'x' cannot read scope 'y'"), so the API
    // never confirms which named scope is access-restricted vs. simply
    // empty (a 200 with no hits). This mirrors the MCP transport layer,
    // which also refuses to reflect raw error text to the wire.
    if (err instanceof ScopeDeniedError) {
      outcome = 'denied';
      errorMessage = err.message;
      res.statusCode = 403;
      setUiHeaders(res);
      res.end(JSON.stringify({ error: 'permission denied' }));
    } else if (err instanceof ValidationError) {
      // Validation errors (bad query params) carry no sensitive data and are
      // useful to the operator, so their message is safe to surface as a 400.
      outcome = 'error';
      errorMessage = err.message;
      res.statusCode = 400;
      setUiHeaders(res);
      res.end(JSON.stringify({ error: err.message }));
    } else {
      // Anything else: log server-side, return a generic 500 without the
      // message (it may carry file paths / SQL fragments).
      outcome = 'error';
      errorMessage = err instanceof Error ? err.message : String(err);
      console.error('[darkcontext ui] handler error:', err);
      res.statusCode = 500;
      setUiHeaders(res);
      res.end(JSON.stringify({ error: 'internal server error' }));
    }
  } finally {
    auditor.record({
      ts: start,
      toolId: caller.id,
      toolName: caller.name,
      mcpTool,
      args: redactArgs(args),
      outcome,
      error: errorMessage,
      durationMs: Date.now() - start,
    });
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
