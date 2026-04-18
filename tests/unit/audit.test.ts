import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { AuditLog, redactArgs } from '../../src/core/audit/index.js';
import { AUDIT_REDACTION_LIMIT } from '../../src/core/constants.js';
import { makeFixture, type Fixture } from '../helpers/factory.js';

describe('redactArgs (fail-closed)', () => {
  it('replaces long strings with a length + prefix/suffix summary regardless of key', () => {
    const body = 'This is a private memory about something personal that should not leak into the audit log.';
    const r = redactArgs({
      // Keys were previously "allowed" but now the policy is by length:
      content: body,
      notes: body, // not in the old CONTENT_KEYS allowlist — must still redact
      prompt: body, // ditto
      kind: 'fact',
    }) as Record<string, unknown>;
    expect(r.content).toMatch(/^<\d+c>/);
    expect(r.notes).toMatch(/^<\d+c>/);
    expect(r.prompt).toMatch(/^<\d+c>/);
    expect(r.content).not.toContain('private memory');
    expect(r.kind).toBe('fact');
  });

  it('short strings pass through verbatim (operational data, not secret)', () => {
    const r = redactArgs({ id: 42, scope: 'work', content: 'short', limit: 10 }) as Record<string, unknown>;
    expect(r.id).toBe(42);
    expect(r.scope).toBe('work');
    expect(r.content).toBe('short');
    expect(r.limit).toBe(10);
  });

  it('redacts nested long strings', () => {
    const long = 'a'.repeat(AUDIT_REDACTION_LIMIT + 50);
    const r = redactArgs({
      outer: {
        inner: { body: long },
        metadata: { tag: 'short' },
      },
    }) as { outer: { inner: { body: string }; metadata: { tag: string } } };
    expect(r.outer.inner.body).toMatch(/^<\d+c>/);
    expect(r.outer.metadata.tag).toBe('short');
  });

  it('redacts strings inside arrays element-wise', () => {
    const long = 'x'.repeat(AUDIT_REDACTION_LIMIT + 10);
    const r = redactArgs([long, 'short', 42]) as unknown[];
    expect(String(r[0])).toMatch(/^<\d+c>/);
    expect(r[1]).toBe('short');
    expect(r[2]).toBe(42);
  });

  it('the threshold cut-off is exactly AUDIT_REDACTION_LIMIT', () => {
    const atLimit = 'a'.repeat(AUDIT_REDACTION_LIMIT);
    const overLimit = 'a'.repeat(AUDIT_REDACTION_LIMIT + 1);
    expect(redactArgs({ c: atLimit })).toEqual({ c: atLimit });
    expect((redactArgs({ c: overLimit }) as { c: string }).c).toMatch(/^<\d+c>/);
  });

  it('top-level strings are redacted too (not only inside objects)', () => {
    const long = 'y'.repeat(AUDIT_REDACTION_LIMIT + 20);
    expect(String(redactArgs(long))).toMatch(/^<\d+c>/);
    expect(redactArgs('short')).toBe('short');
  });

  it('null / undefined survive', () => {
    expect(redactArgs(null)).toBeNull();
    expect(redactArgs(undefined)).toBeUndefined();
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
    expect(rows[0]!.mcpTool).toBe('recall');
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
