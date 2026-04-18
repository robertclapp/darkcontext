import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { AuditLog, redactArgs } from '../../src/core/audit/index.js';
import { makeFixture, type Fixture } from '../helpers/factory.js';

describe('redactArgs', () => {
  it('summarizes content-bearing string fields', () => {
    const r = redactArgs({
      content: 'This is a private memory about something personal that should not leak into the audit log.',
      kind: 'fact',
      tags: ['personal'],
    }) as Record<string, unknown>;
    expect(typeof r.content).toBe('string');
    expect(r.content).toMatch(/^<\d+c>/);
    expect(r.content).not.toContain('private memory');
    expect(r.kind).toBe('fact');
    expect(r.tags).toEqual(['personal']);
  });

  it('redacts nested content/query/text/body fields', () => {
    const r = redactArgs({
      query: 'espresso descaling schedule',
      nested: { body: 'hello world this is long enough to be redacted properly', kind: 'note' },
    }) as { query: string; nested: { body: string; kind: string } };
    expect(r.query).toMatch(/^<\d+c>/);
    expect(r.nested.body).toMatch(/^<\d+c>/);
    expect(r.nested.kind).toBe('note');
  });

  it('passes through non-string values and short strings', () => {
    const r = redactArgs({ id: 42, scope: 'work', content: 'short' }) as Record<string, unknown>;
    expect(r.id).toBe(42);
    expect(r.scope).toBe('work');
    expect(r.content).toBe('<5c>');
  });
});

describe('AuditLog', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => fx.cleanup());

  it('records and lists entries in reverse-chronological order', () => {
    const log = new AuditLog(fx.db, null);
    log.record({
      ts: 1_700_000_000_000, toolId: null, toolName: 't', mcpTool: 'remember',
      args: { kind: 'fact' }, outcome: 'ok', error: null, durationMs: 5,
    });
    log.record({
      ts: 1_700_000_000_500, toolId: null, toolName: 't', mcpTool: 'recall',
      args: { limit: 10 }, outcome: 'ok', error: null, durationMs: 3,
    });
    const rows = log.list();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.mcpTool).toBe('recall'); // newest first
    expect(rows[1]!.mcpTool).toBe('remember');
  });

  it('filters by tool and outcome', () => {
    const log = new AuditLog(fx.db, null);
    const base = { ts: Date.now(), toolId: null, args: {}, durationMs: 1 };
    log.record({ ...base, toolName: 'a', mcpTool: 'recall', outcome: 'ok', error: null });
    log.record({ ...base, toolName: 'b', mcpTool: 'recall', outcome: 'denied', error: 'x' });
    log.record({ ...base, toolName: 'a', mcpTool: 'forget', outcome: 'error', error: 'y' });

    expect(log.list({ toolName: 'a' })).toHaveLength(2);
    expect(log.list({ outcome: 'denied' })).toHaveLength(1);
    expect(log.list({ toolName: 'a', outcome: 'ok' })).toHaveLength(1);
  });

  it('prunes entries older than a cutoff', () => {
    const log = new AuditLog(fx.db, null);
    log.record({ ts: 100, toolId: null, toolName: 't', mcpTool: 'x', args: {}, outcome: 'ok', error: null, durationMs: 1 });
    log.record({ ts: 200, toolId: null, toolName: 't', mcpTool: 'x', args: {}, outcome: 'ok', error: null, durationMs: 1 });
    log.record({ ts: 300, toolId: null, toolName: 't', mcpTool: 'x', args: {}, outcome: 'ok', error: null, durationMs: 1 });
    const n = log.prune(250);
    expect(n).toBe(2);
    expect(log.list()).toHaveLength(1);
  });
});
