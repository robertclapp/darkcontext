import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInit } from '../../src/cli/commands/init.js';
import { runRemember } from '../../src/cli/commands/remember.js';
import { runRecall } from '../../src/cli/commands/recall.js';
import { runForget } from '../../src/cli/commands/forget.js';
import { runList } from '../../src/cli/commands/list.js';
import { runReindex } from '../../src/cli/commands/reindex.js';
import { runExport } from '../../src/cli/commands/export.js';
import { runImportAuto } from '../../src/cli/commands/import.js';
import { runConnect } from '../../src/cli/commands/connect.js';
import { runPrune } from '../../src/cli/commands/prune.js';
import { runSummarize } from '../../src/cli/commands/summarize.js';

/**
 * CLI actions are pure functions. Each takes an output writer so tests can
 * capture stdout without spinning up a Commander program. This file locks in
 * the user-facing contract (output format + exit semantics) that the
 * interactive CLI delivers.
 */

function capture(): { lines: string[]; write: (l: string) => void } {
  const lines: string[] = [];
  return { lines, write: (l) => lines.push(l) };
}

describe('CLI actions (direct invocation)', () => {
  let dir: string;
  let dbPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dcx-cli-'));
    dbPath = join(dir, 'store.db');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('runInit prints store path, provider name, and vec status', async () => {
    const cap = capture();
    await runInit({ db: dbPath }, cap.write);
    const joined = cap.lines.join('\n');
    expect(joined).toContain('DarkContext store ready at:');
    expect(joined).toContain('embeddings provider: stub');
    expect(joined).toMatch(/sqlite-vec:\s+(loaded|unavailable)/);
  });

  it('runRemember writes a memory and echoes #id [scope] content', async () => {
    const cap = capture();
    await runRemember('hello world', { db: dbPath, kind: 'fact', tags: 'greeting' }, cap.write);
    expect(cap.lines[0]).toMatch(/^#\d+ \[default\] hello world$/);
    expect(cap.lines[1]).toBe('  tags: greeting');
  });

  it('runRemember --dedup merges a near-duplicate into the same row', async () => {
    await runRemember('Descale every 60 shots', { db: dbPath, kind: 'fact' }, () => undefined);
    const cap = capture();
    await runRemember(
      'Descale every 60 shots',
      { db: dbPath, kind: 'fact', dedup: true, tags: 'coffee' },
      cap.write
    );
    expect(cap.lines[0]).toMatch(/^merged into #\d+ \[default\] Descale every 60 shots$/);
    expect(cap.lines[1]).toBe('  tags: coffee');
  });

  it('runRemember --dedup --dedup-distance 0 disables merging', async () => {
    await runRemember('same string', { db: dbPath, kind: 'fact' }, () => undefined);
    const cap = capture();
    await runRemember(
      'same string',
      { db: dbPath, kind: 'fact', dedup: true, dedupDistance: 0 },
      cap.write
    );
    // Threshold 0 rejects every candidate, so we expect a fresh "stored" row.
    expect(cap.lines[0]).toMatch(/^stored #\d+ \[default\] same string$/);
  });

  it('runRecall returns (no matches) when the store is empty', async () => {
    const cap = capture();
    await runInit({ db: dbPath }, () => undefined);
    await runRecall('anything', { db: dbPath, limit: 5 }, cap.write);
    expect(cap.lines).toEqual(['(no matches)']);
  });

  it('runRecall surfaces the previously stored memory', async () => {
    await runRemember('descale espresso every 60 shots', { db: dbPath, kind: 'fact' }, () => undefined);
    const cap = capture();
    await runRecall('espresso descaling', { db: dbPath, limit: 3 }, cap.write);
    expect(cap.lines[0]).toMatch(/descale espresso/);
  });

  it('runForget reports success or a not-found message', async () => {
    await runRemember('will be forgotten', { db: dbPath, kind: 'fact' }, () => undefined);
    const capHit = capture();
    await runForget(1, { db: dbPath }, capHit.write);
    expect(capHit.lines[0]).toBe('forgot #1');

    const capMiss = capture();
    await runForget(9999, { db: dbPath }, capMiss.write);
    expect(capMiss.lines[0]).toBe('no memory with id 9999');
  });

  it('runList sorts newest first', async () => {
    await runRemember('first', { db: dbPath, kind: 'fact' }, () => undefined);
    await runRemember('second', { db: dbPath, kind: 'fact' }, () => undefined);
    const cap = capture();
    await runList({ db: dbPath, limit: 10 }, cap.write);
    expect(cap.lines[0]).toMatch(/^#\d+ \[default\] second$/);
    expect(cap.lines[1]).toMatch(/^#\d+ \[default\] first$/);
  });

  it('runReindex reports per-domain counts', async () => {
    await runRemember('alpha', { db: dbPath, kind: 'fact' }, () => undefined);
    const cap = capture();
    await runReindex({ db: dbPath }, cap.write);
    const joined = cap.lines.join('\n');
    expect(joined).toMatch(/memories: 1 rows/);
    expect(joined).toMatch(/document_chunks: 0 rows/);
    expect(joined).toMatch(/messages: 0 rows/);
  });

  it('runReindex --only memories skips the other domains', async () => {
    await runRemember('alpha', { db: dbPath, kind: 'fact' }, () => undefined);
    const cap = capture();
    await runReindex({ db: dbPath, only: 'memories' }, cap.write);
    const joined = cap.lines.join('\n');
    expect(joined).toContain('memories: 1 rows');
    expect(joined).not.toContain('document_chunks');
    expect(joined).not.toContain('messages');
  });

  it('runReindex rejects an unknown --only kind', async () => {
    await expect(
      runReindex({ db: dbPath, only: 'bogus' }, () => undefined)
    ).rejects.toThrow(/unknown kind/);
  });

  it('runIngest rejects chunk-overlap >= chunk-size', async () => {
    const { runIngest } = await import('../../src/cli/commands/ingest.js');
    const tmpFile = join(dir, 'sample.txt');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(tmpFile, 'hello world');
    await expect(
      runIngest(
        tmpFile,
        { db: dbPath, mime: 'text/plain', chunkSize: 100, chunkOverlap: 100 },
        () => undefined
      )
    ).rejects.toThrow(/smaller than chunk-size/);
  });

  it('runIngest prints a one-line summary on success', async () => {
    const { runIngest } = await import('../../src/cli/commands/ingest.js');
    const { writeFileSync } = await import('node:fs');
    const tmpFile = join(dir, 'ok.txt');
    writeFileSync(tmpFile, 'hello world — enough content to chunk');
    const cap = capture();
    await runIngest(
      tmpFile,
      { db: dbPath, mime: 'text/plain', chunkSize: 100, chunkOverlap: 10 },
      cap.write
    );
    // Shape: `#<id> [<scope>] <title> — <n> chunks`
    expect(cap.lines[0]).toMatch(/^#\d+ \[default\] ok\.txt — \d+ chunks$/);
  });


  it('runPrune reports "nothing to prune" when no retention rules exist', async () => {
    const cap = capture();
    await runPrune({ db: dbPath }, cap.write);
    expect(cap.lines[0]).toBe('no scopes have retention rules configured — nothing to prune');
  });

  it('runPrune --scope with no rule prints a friendly message (not an uncaught error)', async () => {
    const cap = capture();
    await runPrune({ db: dbPath, scope: 'ghost' }, cap.write);
    expect(cap.lines[0]).toBe("scope 'ghost' has no retention rule — nothing to prune");
  });

  it('runPrune rejects --scope "" / whitespace — never silently sweeps every scope', async () => {
    // Destructive command: `dcx prune --scope "$SCOPE"` against an unset
    // variable must not degrade to an unscoped (= all-scopes) sweep.
    await expect(runPrune({ db: dbPath, scope: '' }, () => undefined)).rejects.toThrow(/scope/);
    await expect(runPrune({ db: dbPath, scope: '   ' }, () => undefined)).rejects.toThrow(/scope/);
  });

  it('runPrune --dry-run describes what would be deleted per scope', async () => {
    // Seed a scope with retention and aged content.
    const { AppContext } = await import('../../src/core/context.js');
    const ctx = AppContext.open({ dbPath, embeddings: 'stub' });
    try {
      ctx.retention.set('chat', 3);
      await ctx.memories.remember({ content: 'old', scope: 'chat' });
      ctx.db.raw
        .prepare('UPDATE memories SET created_at = ?')
        .run(Date.now() - 100 * 86_400_000);
    } finally {
      ctx.close();
    }

    const cap = capture();
    await runPrune({ db: dbPath, dryRun: true }, cap.write);
    expect(cap.lines[0]).toMatch(/chat \(retention 3d, cutoff .*\): would delete memories=1/);
    expect(cap.lines.at(-1)).toBe(
      'total: would delete memories=1 documents=0 conversations=0 workspace_items=0'
    );
  });

  it('runExport writes a snapshot file and prints a summary', async () => {
    const { readFileSync } = await import('node:fs');
    await runRemember('fact', { db: dbPath, kind: 'fact' });
    const out = join(dir, 'snap.json');
    const cap = capture();
    await runExport({ db: dbPath, out, pretty: true }, cap.write);
    expect(cap.lines[0]).toMatch(/^export ok: .+snap\.json \(memories=1, documents=0/);
    const parsed = JSON.parse(readFileSync(out, 'utf8'));
    expect(parsed.memories).toHaveLength(1);
    expect(parsed.memories[0].content).toBe('fact');
  });

  it('runExport rejects --scope "" / --out "" rather than silently defaulting', async () => {
    await runRemember('leak-me-please', { db: dbPath, kind: 'fact', scope: 'secret' });
    await expect(runExport({ db: dbPath, scope: '' }, () => undefined)).rejects.toThrow(/scope/);
    await expect(runExport({ db: dbPath, out: '' }, () => undefined)).rejects.toThrow(/out/);
  });

  it('runImportAuto discovers Claude Code + Codex sessions and is idempotent', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const ccRoot = join(dir, 'claude', 'projects', 'repo-x');
    const cxRoot = join(dir, 'codex', 'sessions', '2024', '06', '01');
    mkdirSync(ccRoot, { recursive: true });
    mkdirSync(cxRoot, { recursive: true });

    writeFileSync(
      join(ccRoot, 'sess-1.jsonl'),
      [
        JSON.stringify({ type: 'user', sessionId: 'sess-1', timestamp: '2024-06-01T10:00:00Z', message: { role: 'user', content: 'how to descale espresso' } }),
        JSON.stringify({ type: 'assistant', sessionId: 'sess-1', timestamp: '2024-06-01T10:00:01Z', message: { role: 'assistant', content: [{ type: 'text', text: 'citric every 60 shots' }] } }),
      ].join('\n')
    );
    writeFileSync(
      join(cxRoot, 'rollout-1.jsonl'),
      [
        JSON.stringify({ type: 'session_meta', payload: { id: 'codex-1' } }),
        JSON.stringify({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'debug the race condition' }] }),
      ].join('\n')
    );

    const cap = capture();
    await runImportAuto({ db: dbPath, claudeCodeRoot: join(dir, 'claude', 'projects'), codexRoot: join(dir, 'codex', 'sessions') }, cap.write);
    const joined = cap.lines.join('\n');
    expect(joined).toMatch(/claude-code: 1 files → 1 new conversations/);
    expect(joined).toMatch(/codex: 1 files → 1 new conversations/);

    // Both sessions are now searchable across tools via history search.
    const { AppContext } = await import('../../src/core/context.js');
    const ctx = AppContext.open({ dbPath, embeddings: 'stub' });
    try {
      const hits = await ctx.conversations.search('espresso descale', { limit: 5 });
      expect(hits.some((h) => h.source === 'claude-code')).toBe(true);
    } finally {
      ctx.close();
    }

    // Re-running imports nothing new (idempotent on session id).
    const cap2 = capture();
    await runImportAuto({ db: dbPath, claudeCodeRoot: join(dir, 'claude', 'projects'), codexRoot: join(dir, 'codex', 'sessions') }, cap2.write);
    expect(cap2.lines.join('\n')).toMatch(/claude-code: 1 files → 0 new conversations/);
  });

  it('runImportAuto reports cleanly when no session dirs exist', async () => {
    const cap = capture();
    await runImportAuto({ db: dbPath, claudeCodeRoot: join(dir, 'nope-cc'), codexRoot: join(dir, 'nope-cx') }, cap.write);
    expect(cap.lines.join('\n')).toContain('no sessions found');
  });

  it('runConnect provisions a token and prints client-specific config', async () => {
    const cc = capture();
    await runConnect('claude-code', { db: dbPath, scopes: 'shared' }, cc.write);
    const ccText = cc.lines.join('\n');
    expect(ccText).toMatch(/Provisioned 'claude-code' for claude-code/);
    expect(ccText).toMatch(/dcx_[A-Za-z0-9_-]+/); // token present
    expect(ccText).toMatch(/\.mcp\.json|claude mcp add-json/);

    const cx = capture();
    await runConnect('codex', { db: dbPath, scopes: 'shared' }, cx.write);
    expect(cx.lines.join('\n')).toMatch(/\[mcp_servers\.codex\]/);
  });

  it('runConnect rejects an unknown client', async () => {
    await expect(
      runConnect('emacs', { db: dbPath, scopes: 'shared' }, () => undefined)
    ).rejects.toThrow(/unknown client/);
  });

  it('runConnect --rotate reports the tool\'s real grants, not the passed flags', async () => {
    // Provision read-write on `shared`.
    await runConnect('cursor', { db: dbPath, scopes: 'shared' }, () => undefined);
    // Rotate with conflicting flags: rotation keeps grants, so the output
    // must advertise the ACTUAL boundary (shared, read-write), never the
    // misleading `acme (read-only)` the flags would suggest.
    const cap = capture();
    await runConnect(
      'cursor',
      { db: dbPath, scopes: 'acme', readOnly: true, rotate: true },
      cap.write
    );
    const text = cap.lines.join('\n');
    expect(text).toMatch(/Rotated token for 'cursor'/);
    expect(text).toContain('scopes: shared');
    expect(text).not.toContain('acme');
    expect(text).not.toContain('(read-only)');
  });

  it('runConnect --rotate provisions on first use when the tool is absent', async () => {
    const cap = capture();
    await runConnect('codex', { db: dbPath, scopes: 'shared', rotate: true }, cap.write);
    // No pre-existing tool → falls through to create(), so it's a fresh
    // provision (not a rotation) and honors the passed scopes.
    expect(cap.lines.join('\n')).toMatch(/Provisioned 'codex' for codex/);
    expect(cap.lines.join('\n')).toContain('scopes: shared');
  });

  it('runSummarize prints a header line then the LLM summary body', async () => {
    // Seed history through a direct AppContext so we exercise the same path
    // the user would: import → summarize.
    const { AppContext } = await import('../../src/core/context.js');
    const ctx = AppContext.open({ dbPath, embeddings: 'stub' });
    try {
      await ctx.conversations.ingest('chatgpt', [
        {
          externalId: 'c1',
          title: 'chat',
          startedAt: 1_700_000_000_000,
          messages: [
            { role: 'user', content: 'how do I descale espresso every 60 shots?', ts: 1_700_000_000_000 },
          ],
        },
      ], { scope: 'home' });
    } finally {
      ctx.close();
    }

    const cap = capture();
    await runSummarize('espresso descaling', { db: dbPath, scope: 'home' }, cap.write);
    expect(cap.lines[0]).toMatch(/^topic: espresso descaling \(scope=home, source=-, sources=\d+, provider=stub\)$/);
    expect(cap.lines[1]!.startsWith('summary:')).toBe(true);
  });

  it('runSummarize --save reports the persisted memory id', async () => {
    const { AppContext } = await import('../../src/core/context.js');
    const ctx = AppContext.open({ dbPath, embeddings: 'stub' });
    try {
      await ctx.conversations.ingest('chatgpt', [
        {
          externalId: 'c2',
          title: 'chat',
          startedAt: 1_700_000_000_000,
          messages: [{ role: 'user', content: 'tennis grip notes', ts: 1_700_000_000_000 }],
        },
      ], { scope: 'home' });
    } finally {
      ctx.close();
    }

    const cap = capture();
    await runSummarize('tennis', { db: dbPath, scope: 'home', save: true }, cap.write);
    expect(cap.lines.at(-1)).toMatch(/^saved as memory #\d+$/);
  });

  it('runSummarize --save without --scope is rejected (no implicit default-scope writes)', async () => {
    // Cross-scope leak guard: an unscoped retrieval would pull from EVERY
    // readable scope, and `--save` would then persist the LLM-synthesized
    // result into `default`. That would silently smuggle content from
    // tighter scopes into the broadly-readable `default`. Block at the CLI.
    await expect(
      runSummarize('anything', { db: dbPath, save: true }, () => undefined)
    ).rejects.toThrow(/scope/);
  });
});
