import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startHttpServer, type StartedHttpServer } from '../../src/mcp/httpServer.js';
import { openDb } from '../../src/core/store/db.js';
import { Tools } from '../../src/core/tools/index.js';

describe('HTTP transport bearer auth', () => {
  let dir: string;
  let dbPath: string;
  let token: string;
  let started: StartedHttpServer;
  let baseUrl: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dcx-http-'));
    dbPath = join(dir, 'store.db');
    // Provision a tool so we have a valid token.
    const db = openDb({ path: dbPath });
    const tools = new Tools(db);
    const provisioned = tools.create({ name: 'http-test', scopes: ['default'] });
    token = provisioned.token;
    db.close();

    started = await startHttpServer({ dbPath, token, port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${started.port}`;
  });

  afterEach(async () => {
    await started.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns 401 with no Authorization header', async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('returns 401 for a bogus bearer token', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { authorization: 'Bearer dcx_not_the_right_token' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts the correct bearer token (no 401, may be 4xx/2xx from MCP)', async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.1' },
      }}),
    });
    // Any non-401 response means auth passed — the protocol-level status may
    // vary, but the security boundary is what we're testing.
    expect(res.status).not.toBe(401);
  });

  it('accepts any case for the Bearer scheme (RFC 7235 case-insensitive)', async () => {
    for (const scheme of ['Bearer', 'bearer', 'BEARER', 'BeArEr']) {
      const res = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `${scheme} ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'case-test', version: '0.0.1' },
          },
        }),
      });
      expect(res.status, `scheme=${scheme}`).not.toBe(401);
    }
  });

  it('rejects HTTP startup if the token does not match any registered tool', async () => {
    await expect(
      startHttpServer({ dbPath, token: 'dcx_ghost_token', port: 0 })
    ).rejects.toThrow(/does not match/);
  });

  it('serves GET /healthz without auth and reports ok + version + schemaVersion', async () => {
    // Explicitly NO Authorization header: /healthz must answer anonymously
    // or it's useless for uptime monitoring / load balancer probes.
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = (await res.json()) as { ok: boolean; version: string; schemaVersion: number };
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe('string');
    expect(body.schemaVersion).toBeGreaterThan(0);
  });

  it('supports HEAD /healthz (load balancers probe with HEAD to skip the body)', async () => {
    const res = await fetch(`${baseUrl}/healthz`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    // HEAD responses must not carry a body.
    const text = await res.text();
    expect(text).toBe('');
  });

  it('rejects cleanly when the bind port is already in use (does not crash the process)', async () => {
    // Start a second server on the same port as the first one. Previously
    // the listen() wrapper only resolved on success, so EADDRINUSE escaped
    // as an unhandled 'error' event and killed the process. With the error
    // handler in place it should surface as a rejected promise — and the
    // AppContext opened internally must still be closed cleanly.
    const occupiedPort = started.port;
    await expect(
      startHttpServer({ dbPath, token, port: occupiedPort, host: '127.0.0.1' })
    ).rejects.toThrow(/EADDRINUSE/);
  });
});
