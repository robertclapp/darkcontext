import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ALL_MCP_TOOLS } from '../../src/mcp/tools/registry.js';
import { ScopeFilter } from '../../src/mcp/scopeFilter.js';
import type { ToolWithGrants } from '../../src/core/tools/index.js';
import { makeFixture, type Fixture } from '../helpers/factory.js';

function fakeTool(name: string, grants: Array<{ scope: string; r: boolean; w: boolean }>): ToolWithGrants {
  return {
    id: 1, name, createdAt: Date.now(), lastSeenAt: null,
    grants: grants.map((g) => ({ scope: g.scope, canRead: g.r, canWrite: g.w })),
  };
}

describe('MCP tool registry (tools-as-data)', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => fx.cleanup());

  it('exposes a stable set of tools', () => {
    const names = ALL_MCP_TOOLS.map((t) => t.name).sort();
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
  });

  it('every tool has a unique name', () => {
    const names = ALL_MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every tool has non-empty title + description', () => {
    for (const t of ALL_MCP_TOOLS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.handler).toBe('function');
    }
  });

  it('tool handlers can be invoked directly against a ScopeFilter (unit-testable without an MCP server)', async () => {
    const filter = new ScopeFilter(
      fakeTool('t', [{ scope: 'default', r: true, w: true }]),
      {
        memories: fx.memories,
        documents: fx.documents,
        workspaces: fx.workspaces,
        conversations: fx.conversations,
      }
    );
    const remember = ALL_MCP_TOOLS.find((t) => t.name === 'remember')!;
    const result = await remember.handler(
      { content: 'directly invoked' } as never,
      { filter }
    );
    expect(result.isError).toBeFalsy();
    const struct = result.structuredContent as { id?: number } | undefined;
    expect(struct?.id).toBeGreaterThan(0);
  });
});
