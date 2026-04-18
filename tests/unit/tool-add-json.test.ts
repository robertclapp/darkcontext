import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runToolAdd, type ToolAddJsonOutput } from '../../src/cli/commands/tool.js';
import { looksLikeToken } from '../../src/core/tools/index.js';

/**
 * `dcx tool add --json` is part of the scriptable contract — the demo
 * script in examples/curl-http-demo.sh parses its output with jq, and
 * external launchers may do the same. These tests lock in both the
 * shape (so removing a field is a visible break) and the key invariants
 * (single line of valid JSON; token follows generateToken's regex;
 * mcpServerConfig is a drop-in for Claude Desktop).
 */

describe('dcx tool add --json', () => {
  let dir: string;
  let dbPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dcx-tool-'));
    dbPath = join(dir, 'store.db');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('emits a single parseable JSON object with tool + token + grants + mcpServerConfig', async () => {
    const lines: string[] = [];
    await runToolAdd(
      'demo',
      { db: dbPath, scopes: 'personal,work', readOnly: false, json: true },
      (l) => lines.push(l)
    );
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]!) as ToolAddJsonOutput;
    expect(parsed.tool.name).toBe('demo');
    expect(parsed.tool.id).toBeGreaterThan(0);
    expect(looksLikeToken(parsed.token)).toBe(true);

    // Grants round-trip every scope requested + correct default perms.
    const scopes = parsed.grants.map((g) => g.scope).sort();
    expect(scopes).toEqual(['personal', 'work']);
    expect(parsed.grants.every((g) => g.canRead && g.canWrite)).toBe(true);

    // mcpServerConfig is the exact Claude-Desktop-ready entry.
    expect(parsed.mcpServerConfig.command).toBe('dcx');
    expect(parsed.mcpServerConfig.args[0]).toBe('serve');
    expect(parsed.mcpServerConfig.env.DARKCONTEXT_TOKEN).toBe(parsed.token);
  });

  it('--read-only is reflected in the JSON grant rows', async () => {
    const lines: string[] = [];
    await runToolAdd(
      'ro',
      { db: dbPath, scopes: 'shared', readOnly: true, json: true },
      (l) => lines.push(l)
    );
    const parsed = JSON.parse(lines[0]!) as ToolAddJsonOutput;
    expect(parsed.grants[0]!.canRead).toBe(true);
    expect(parsed.grants[0]!.canWrite).toBe(false);
  });

  it('passes --db through to the emitted mcpServerConfig.args', async () => {
    const lines: string[] = [];
    await runToolAdd(
      't',
      { db: dbPath, scopes: 'default', readOnly: false, json: true },
      (l) => lines.push(l)
    );
    const parsed = JSON.parse(lines[0]!) as ToolAddJsonOutput;
    // "--db <path>" must survive into the args array so pasted configs
    // stay usable when the store path is non-default.
    expect(parsed.mcpServerConfig.args).toContain('--db');
    expect(parsed.mcpServerConfig.args).toContain(dbPath);
  });

  it('without --json, falls back to the human banner (multiple lines)', async () => {
    const lines: string[] = [];
    await runToolAdd(
      'human',
      { db: dbPath, scopes: 'default', readOnly: false, json: false },
      (l) => lines.push(l)
    );
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toMatch(/^Provisioned tool 'human'/);
  });
});
