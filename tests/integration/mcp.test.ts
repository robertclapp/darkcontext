import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildServer } from '../../src/mcp/server.js';
import { ScopeFilter } from '../../src/mcp/scopeFilter.js';
import type { ToolWithGrants } from '../../src/core/tools/index.js';
import { makeFixture, type Fixture } from '../helpers/factory.js';

function fakeTool(name: string, grants: Array<{ scope: string; r: boolean; w: boolean }>): ToolWithGrants {
  return {
    id: 1,
    name,
    createdAt: Date.now(),
    lastSeenAt: null,
    grants: grants.map((g) => ({ scope: g.scope, canRead: g.r, canWrite: g.w })),
  };
}

interface RecordedAudit {
  mcpTool: string;
  outcome: string;
  args: unknown;
  error: string | null;
}

async function connectPair(filter: ScopeFilter, recorded?: RecordedAudit[]): Promise<Client> {
  const auditor = {
    record: (entry: RecordedAudit) => {
      recorded?.push({
        mcpTool: entry.mcpTool,
        outcome: entry.outcome,
        args: entry.args,
        error: entry.error,
      });
    },
  };
  const server = buildServer(filter, auditor);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('MCP integration', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => fx.cleanup());

  it('advertises all M2+M3 tools', async () => {
    const filter = new ScopeFilter(fakeTool('t', [{ scope: 'personal', r: true, w: true }]), { memories: fx.memories, documents: fx.documents, workspaces: fx.workspaces, conversations: fx.conversations });
    const client = await connectPair(filter);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'add_to_workspace',
      'forget',
      'get_active_workspace',
      'list_workspaces',
      'recall',
      'remember',
      'search_documents',
      'search_history',
    ]);
    await client.close();
  });

  it('remember → recall round-trip through MCP', async () => {
    const filter = new ScopeFilter(fakeTool('t', [{ scope: 'personal', r: true, w: true }]), { memories: fx.memories, documents: fx.documents, workspaces: fx.workspaces, conversations: fx.conversations });
    const client = await connectPair(filter);

    const remembered = await client.callTool({
      name: 'remember',
      arguments: { content: 'Espresso machine descales every 60 shots', tags: ['coffee'] },
    });
    expect(remembered.isError).toBeFalsy();

    const recalled = await client.callTool({
      name: 'recall',
      arguments: { query: 'espresso descaling', limit: 5 },
    });
    expect(recalled.isError).toBeFalsy();
    const struct = recalled.structuredContent as { hits: Array<{ content: string }> };
    expect(struct.hits.length).toBeGreaterThan(0);
    expect(struct.hits.some((h) => h.content.includes('Espresso'))).toBe(true);
    await client.close();
  });

  it('scope denial surfaces as a tool error (not a protocol error)', async () => {
    const filter = new ScopeFilter(fakeTool('t', [{ scope: 'personal', r: true, w: true }]), { memories: fx.memories, documents: fx.documents, workspaces: fx.workspaces, conversations: fx.conversations });
    const client = await connectPair(filter);

    const res = await client.callTool({
      name: 'remember',
      arguments: { content: 'forbidden', scope: 'work' },
    });
    expect(res.isError).toBe(true);
    const text = Array.isArray(res.content) && res.content[0] && 'text' in res.content[0]
      ? (res.content[0] as { text: string }).text
      : '';
    expect(text).toContain('permission denied');
    await client.close();
  });

  it('recall filters results by readable scopes across tool identities', async () => {
    // Seed memories in two scopes via unscoped admin Memories.
    await fx.memories.remember({ content: 'alice-secret', scope: 'alice' });
    await fx.memories.remember({ content: 'bob-secret', scope: 'bob' });

    const bobOnly = new ScopeFilter(fakeTool('bob', [{ scope: 'bob', r: true, w: true }]), { memories: fx.memories, documents: fx.documents, workspaces: fx.workspaces, conversations: fx.conversations });
    const client = await connectPair(bobOnly);

    const res = await client.callTool({ name: 'recall', arguments: { query: 'secret', limit: 10 } });
    const struct = res.structuredContent as { hits: Array<{ content: string; scope: string }> };
    expect(struct.hits.every((h) => h.scope === 'bob')).toBe(true);
    expect(struct.hits.some((h) => h.content === 'alice-secret')).toBe(false);
    await client.close();
  });

  it('every tool call writes an audit entry with redacted content', async () => {
    const recorded: RecordedAudit[] = [];
    const filter = new ScopeFilter(fakeTool('t', [{ scope: 'personal', r: true, w: true }]), { memories: fx.memories, documents: fx.documents, workspaces: fx.workspaces, conversations: fx.conversations });
    const client = await connectPair(filter, recorded);

    await client.callTool({ name: 'remember', arguments: { content: 'a private memory body that should not leak' } });
    await client.callTool({ name: 'recall', arguments: { query: 'memory' } });
    await client.callTool({ name: 'remember', arguments: { content: 'cross-scope write', scope: 'work' } });

    expect(recorded.length).toBe(3);
    expect(recorded[0]!.mcpTool).toBe('remember');
    expect(recorded[0]!.outcome).toBe('ok');
    expect(JSON.stringify(recorded[0]!.args)).not.toContain('private memory body');
    // Outcome carries the classification; error holds the raw reason without
    // the "permission denied" prefix (which lives in the tool-result text).
    expect(recorded[2]!.outcome).toBe('denied');
    expect(recorded[2]!.error).toMatch(/cannot write to scope 'work'/);
    await client.close();
  });

  it('forget silently no-ops across scope boundaries (no existence leak)', async () => {
    const m = await fx.memories.remember({ content: 'protected', scope: 'alice' });
    const bobOnly = new ScopeFilter(fakeTool('bob', [{ scope: 'bob', r: true, w: true }]), { memories: fx.memories, documents: fx.documents, workspaces: fx.workspaces, conversations: fx.conversations });
    const client = await connectPair(bobOnly);

    const res = await client.callTool({ name: 'forget', arguments: { id: m.id } });
    expect(res.isError).toBeFalsy();
    const struct = res.structuredContent as { deleted: boolean };
    expect(struct.deleted).toBe(false);
    expect(fx.memories.getById(m.id).content).toBe('protected');
    await client.close();
  });
});
