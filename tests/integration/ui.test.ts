import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startHttpServer, type StartedHttpServer } from '../../src/mcp/httpServer.js';
import { AppContext } from '../../src/core/context.js';

interface IdentityBody { tool: string; scopes: Array<{ scope: string; canRead: boolean; canWrite: boolean }> }
interface RecallHitBody { id: number; content: string; scope: string | null; score: number; match: 'vector' | 'keyword' }
interface DocHitBody { documentId: number; title: string; scope: string | null; chunkIdx: number; content: string; score: number }
interface HistoryBody { hits: Array<{ content: string }> }
interface WorkspacesBody { workspaces: Array<{ id: number; name: string; scope: string | null; isActive: boolean }> }
interface ErrorBody { error: string }

describe('Web UI — read-only HTML + JSON API', () => {
  let dir: string;
  let dbPath: string;
  let token: string;
  let started: StartedHttpServer;
  let baseUrl: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dcx-ui-'));
    dbPath = join(dir, 'store.db');

    // Provision a tool + seed some scoped content so the UI has data to
    // surface. We open + close a context for the seed so the HTTP server
    // gets its own DB handle (better-sqlite3 is single-process anyway,
    // but being explicit makes the test independent of WAL flush timing).
    const seedCtx = AppContext.open({ dbPath, embeddings: 'stub' });
    try {
      const provisioned = seedCtx.tools.create({ name: 'ui-test', scopes: ['default'] });
      token = provisioned.token;
      await seedCtx.memories.remember({ content: 'espresso descaling cadence', scope: 'default' });
      await seedCtx.documents.ingest({ title: 'Doc', content: 'descaling chapter', scope: 'default' });
      seedCtx.workspaces.create({ name: 'sprint', scope: 'default' });
    } finally {
      seedCtx.close();
    }

    started = await startHttpServer({ dbPath, token, port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${started.port}`;
  });

  afterEach(async () => {
    await started.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('GET /ui (the HTML shell)', () => {
    it('serves the page unauthenticated (no sensitive data in the shell)', async () => {
      const res = await fetch(`${baseUrl}/ui`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      const body = await res.text();
      expect(body).toContain('<title>DarkContext</title>');
      expect(body).toContain('/ui/api/identity');
    });

    it('sets cache-control: no-store so an upgraded binary serves a fresh UI', async () => {
      const res = await fetch(`${baseUrl}/ui`);
      expect(res.headers.get('cache-control')).toBe('no-store');
    });
  });

  describe('GET /ui/api/* (the JSON API)', () => {
    it('returns 401 for an API call without a bearer token', async () => {
      const res = await fetch(`${baseUrl}/ui/api/identity`);
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('Bearer');
    });

    it('returns 401 for a wrong bearer token', async () => {
      const res = await fetch(`${baseUrl}/ui/api/identity`, {
        headers: { authorization: 'Bearer dcx_wrong' },
      });
      expect(res.status).toBe(401);
    });

    it('identity reports the calling tool and its grants', async () => {
      const res = await authedFetch('/ui/api/identity');
      expect(res.status).toBe(200);
      const body = (await res.json()) as IdentityBody;
      expect(body.tool).toBe('ui-test');
      expect(body.scopes).toEqual([
        { scope: 'default', canRead: true, canWrite: true },
      ]);
    });

    it('recall returns scope-filtered hits with score + match', async () => {
      const res = await authedFetch('/ui/api/recall?q=espresso&limit=5');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { hits: RecallHitBody[] };
      expect(body.hits.length).toBeGreaterThan(0);
      const hit = body.hits[0]!;
      expect(hit.scope).toBe('default');
      expect(hit.content).toContain('espresso');
      expect(typeof hit.score).toBe('number');
      expect(['vector', 'keyword']).toContain(hit.match);
    });

    it('document search surfaces document chunks', async () => {
      const res = await authedFetch('/ui/api/documents/search?q=descaling&limit=5');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { hits: DocHitBody[] };
      expect(body.hits.length).toBeGreaterThan(0);
      const hit = body.hits[0]!;
      expect(hit.title).toBe('Doc');
      expect(hit.scope).toBe('default');
      expect(typeof hit.chunkIdx).toBe('number');
    });

    it('history search returns an empty hits array when no conversations are imported', async () => {
      const res = await authedFetch('/ui/api/history?q=anything');
      expect(res.status).toBe(200);
      const body = (await res.json()) as HistoryBody;
      expect(body.hits).toEqual([]);
    });

    it('workspaces lists every readable workspace', async () => {
      const res = await authedFetch('/ui/api/workspaces');
      expect(res.status).toBe(200);
      const body = (await res.json()) as WorkspacesBody;
      expect(body.workspaces.map((w) => w.name)).toContain('sprint');
    });

    it('rejects mutating methods (read-only API)', async () => {
      const res = await authedFetch('/ui/api/identity', { method: 'POST' });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET');
    });

    it('returns 404 for an unknown /ui/api path', async () => {
      const res = await authedFetch('/ui/api/does-not-exist');
      expect(res.status).toBe(404);
    });

    it('rejects an unreadable explicit scope as a 400 with the ScopeFilter message', async () => {
      const res = await authedFetch('/ui/api/recall?q=x&scope=other');
      expect(res.status).toBe(400);
      const body = (await res.json()) as ErrorBody;
      expect(body.error).toMatch(/scope|denied/i);
    });
  });

  describe('routing isolation', () => {
    it('the /ui carve-out does not break the /mcp transport (still bearer-gated)', async () => {
      const res = await fetch(`${baseUrl}/mcp`, { method: 'POST' });
      expect(res.status).toBe(401);
    });
  });

  function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${token}`,
      },
    });
  }
});
