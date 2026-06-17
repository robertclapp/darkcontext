import { describe, it, expect } from 'vitest';

import { ClaudeCodeImporter, CodexImporter, resolveImporter } from '../../src/core/importers/index.js';

describe('ClaudeCodeImporter', () => {
  const imp = new ClaudeCodeImporter();

  it('linearizes a JSONL session into one conversation, keeping user/assistant text', () => {
    const raw = [
      JSON.stringify({ type: 'user', sessionId: 'sess-abc', timestamp: '2024-06-01T10:00:00Z', message: { role: 'user', content: 'How do I descale my espresso machine?' } }),
      JSON.stringify({ type: 'assistant', sessionId: 'sess-abc', timestamp: '2024-06-01T10:00:05Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Run a citric solution every 60 shots.' }] } }),
      JSON.stringify({ type: 'summary', summary: 'espresso care' }), // skipped: no message role
      '{ this is not valid json',                                    // skipped: tolerant
    ].join('\n');

    const convs = imp.parse(raw);
    expect(convs).toHaveLength(1);
    const c = convs[0]!;
    expect(c.externalId).toBe('sess-abc');
    expect(c.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(c.messages[1]!.content).toContain('citric solution');
    expect(c.title).toContain('descale');
    expect(c.startedAt).toBe(Date.parse('2024-06-01T10:00:00Z'));
  });

  it('skips tool-only / empty-text events and returns [] when nothing remains', () => {
    const raw = [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'bash', input: {} }] } }),
      JSON.stringify({ type: 'system', subtype: 'init' }),
    ].join('\n');
    expect(imp.parse(raw)).toEqual([]);
  });

  it('is resolvable by kind "claude-code"', () => {
    expect(resolveImporter('claude-code').source).toBe('claude-code');
  });
});

describe('CodexImporter', () => {
  const imp = new CodexImporter();

  it('handles both bare and payload-wrapped message shapes + a session_meta id', () => {
    const raw = [
      JSON.stringify({ type: 'session_meta', payload: { id: 'codex-123' } }),
      JSON.stringify({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'explain the race condition' }] }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'two writers, no lock' }] } }),
      JSON.stringify({ type: 'reasoning', payload: { text: 'internal thought' } }), // no role → skipped
    ].join('\n');

    const convs = imp.parse(raw);
    expect(convs).toHaveLength(1);
    const c = convs[0]!;
    expect(c.externalId).toBe('codex-123');
    expect(c.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(c.messages[0]!.content).toContain('race condition');
    expect(c.messages[1]!.content).toContain('no lock');
    expect(c.title).toContain('race condition');
  });

  it('returns [] for an empty or message-less rollout', () => {
    expect(imp.parse('')).toEqual([]);
    expect(imp.parse(JSON.stringify({ type: 'session_meta', payload: { id: 'x' } }))).toEqual([]);
  });

  it('does not take sessionId from non-session_meta lines that happen to carry an id', () => {
    // Anthropic-style response shapes can put a top-level `id` on a plain
    // message event. The `!sessionId` first-match guard means such a line
    // would clobber the real session_meta id and corrupt the dedup key
    // unless the condition is gated to session_meta lines specifically.
    const raw = [
      JSON.stringify({ type: 'message', id: 'msg-1', role: 'user', content: 'hello' }),
      JSON.stringify({ type: 'session_meta', payload: { id: 'codex-real' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: 'world' } }),
    ].join('\n');
    const convs = imp.parse(raw);
    expect(convs).toHaveLength(1);
    expect(convs[0]!.externalId).toBe('codex-real');
  });

  it('is resolvable by kind "codex"', () => {
    expect(resolveImporter('codex').source).toBe('codex');
  });
});
