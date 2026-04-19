import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AppContext } from '../../src/core/context.js';
import { Summarize } from '../../src/core/summarize/index.js';
import type { LLMProvider, CompleteOptions } from '../../src/core/llm/index.js';
import { ValidationError } from '../../src/core/errors.js';

class RecordingLLM implements LLMProvider {
  readonly name = 'recording';
  prompts: string[] = [];
  options: CompleteOptions[] = [];
  reply = 'canned reply';
  async complete(prompt: string, opts: CompleteOptions = {}): Promise<string> {
    this.prompts.push(prompt);
    this.options.push(opts);
    return this.reply;
  }
}

describe('Summarize', () => {
  let tmp: string;
  let ctx: AppContext;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'dcx-sum-'));
    ctx = AppContext.open({ dbPath: join(tmp, 'store.db'), embeddings: 'stub' });
  });

  afterEach(() => {
    ctx.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  async function seedHistory(): Promise<void> {
    await ctx.conversations.ingest(
      'chatgpt',
      [
        {
          externalId: 'c1',
          title: 'Espresso talk',
          startedAt: 1_700_000_000_000,
          messages: [
            { role: 'user', content: 'how do I descale my espresso machine?', ts: 1_700_000_000_000 },
            { role: 'assistant', content: 'Run a citric solution every 60 shots.', ts: 1_700_000_001_000 },
          ],
        },
      ],
      { scope: 'home' }
    );
    await ctx.conversations.ingest(
      'claude',
      [
        {
          externalId: 'c2',
          title: 'Tennis tips',
          startedAt: 1_700_000_010_000,
          messages: [
            { role: 'user', content: 'tell me about tennis grips', ts: 1_700_000_010_000 },
            { role: 'assistant', content: 'Eastern grip is most versatile.', ts: 1_700_000_011_000 },
          ],
        },
      ],
      { scope: 'home' }
    );
  }

  it('builds a prompt that includes the topic and retrieved messages, then returns the LLM reply', async () => {
    await seedHistory();
    const llm = new RecordingLLM();
    const summarize = new Summarize(ctx.conversations, ctx.memories, llm);

    const result = await summarize.run({ topic: 'espresso descaling', scope: 'home' });
    expect(result.summary).toBe('canned reply');
    expect(result.scope).toBe('home');
    expect(result.sourceCount).toBeGreaterThan(0);
    expect(result.savedMemoryId).toBeNull();
    expect(result.provider).toBe('recording');

    expect(llm.prompts).toHaveLength(1);
    const prompt = llm.prompts[0]!;
    expect(prompt).toContain('TOPIC: espresso descaling');
    expect(prompt).toContain('descale');
  });

  it("respects --source filter (don't pull conversations from other importers)", async () => {
    await seedHistory();
    const llm = new RecordingLLM();
    const summarize = new Summarize(ctx.conversations, ctx.memories, llm);

    const result = await summarize.run({
      topic: 'tips',
      scope: 'home',
      source: 'claude',
    });
    const prompt = llm.prompts[0]!;
    expect(prompt).not.toContain('chatgpt');
    expect(prompt).toContain('[claude');
    expect(result.source).toBe('claude');
  });

  it('forwards maxTokens and a low temperature to the provider', async () => {
    await seedHistory();
    const llm = new RecordingLLM();
    const summarize = new Summarize(ctx.conversations, ctx.memories, llm);
    await summarize.run({ topic: 'espresso', scope: 'home', maxTokens: 80 });
    const opts = llm.options[0]!;
    expect(opts.maxTokens).toBe(80);
    expect(opts.temperature).toBeLessThan(0.5);
  });

  it('produces a usable prompt even when retrieval finds nothing', async () => {
    const llm = new RecordingLLM();
    const summarize = new Summarize(ctx.conversations, ctx.memories, llm);
    const result = await summarize.run({ topic: 'no-history-here', scope: 'home' });
    expect(result.sourceCount).toBe(0);
    expect(llm.prompts[0]).toContain('No relevant history found');
  });

  it('save: true persists the result as a kind=summary memory in the requested scope', async () => {
    await seedHistory();
    const llm = new RecordingLLM();
    llm.reply = 'A short summary about espresso descaling cadence.';
    const summarize = new Summarize(ctx.conversations, ctx.memories, llm);

    const result = await summarize.run({ topic: 'espresso', scope: 'home', save: true });
    expect(result.savedMemoryId).not.toBeNull();
    const saved = ctx.memories.getById(result.savedMemoryId!);
    expect(saved.scope).toBe('home');
    expect(saved.kind).toBe('summary');
    expect(saved.source).toBe('summary:espresso');
    expect(saved.content).toBe('A short summary about espresso descaling cadence.');
  });

  it('rejects an empty topic with ValidationError', async () => {
    const llm = new RecordingLLM();
    const summarize = new Summarize(ctx.conversations, ctx.memories, llm);
    await expect(summarize.run({ topic: '   ', scope: 'home' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('clamps a too-large limit at 100', async () => {
    await seedHistory();
    const llm = new RecordingLLM();
    const summarize = new Summarize(ctx.conversations, ctx.memories, llm);
    // limit:5000 should not throw — it's silently clamped to MAX_LIMIT.
    await summarize.run({ topic: 'espresso', scope: 'home', limit: 5000 });
    expect(llm.prompts).toHaveLength(1);
  });

  it('rejects a non-positive or non-integer limit with ValidationError', async () => {
    const llm = new RecordingLLM();
    const summarize = new Summarize(ctx.conversations, ctx.memories, llm);
    await expect(summarize.run({ topic: 't', scope: 'home', limit: 0 })).rejects.toBeInstanceOf(ValidationError);
    await expect(summarize.run({ topic: 't', scope: 'home', limit: 1.5 })).rejects.toBeInstanceOf(ValidationError);
  });

  it('the stub LLM (used by AppContext default) returns a deterministic summary string', async () => {
    await seedHistory();
    // Use AppContext's wired-in summarize, which uses StubLLMProvider by default.
    const result = await ctx.summarize.run({ topic: 'espresso', scope: 'home' });
    expect(result.provider).toBe('stub');
    expect(result.summary.startsWith('summary:')).toBe(true);
  });
});
