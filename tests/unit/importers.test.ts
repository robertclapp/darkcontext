import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ChatGPTImporter,
  ClaudeImporter,
  GeminiImporter,
  GenericImporter,
  ImporterParseError,
  resolveImporter,
} from '../../src/core/importers/index.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

describe('ChatGPTImporter', () => {
  it('linearizes the mapping tree into chronological messages', () => {
    const convs = new ChatGPTImporter().parse(fixture('chatgpt.conversations.json'));
    expect(convs).toHaveLength(2);
    const first = convs[0]!;
    expect(first.externalId).toBe('conv-1');
    expect(first.title).toBe('Espresso maintenance');
    expect(first.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(first.messages[0]!.content).toContain('descale');
    expect(first.messages[0]!.ts).toBe(Math.round(1700000000.5 * 1000));
  });

  it('rejects non-array input', () => {
    expect(() => new ChatGPTImporter().parse('{}')).toThrow(ImporterParseError);
  });

  it('skips conversations without a mapping', () => {
    const raw = JSON.stringify([{ id: 'x', title: 'empty' }]);
    expect(new ChatGPTImporter().parse(raw)).toEqual([]);
  });
});

describe('ClaudeImporter', () => {
  it('parses text + content-block messages and normalizes sender', () => {
    const convs = new ClaudeImporter().parse(fixture('claude.export.json'));
    expect(convs).toHaveLength(1);
    const c = convs[0]!;
    expect(c.title).toBe('DarkContext architecture');
    expect(c.messages).toHaveLength(2);
    expect(c.messages[0]!.role).toBe('user'); // 'human' -> 'user'
    expect(c.messages[1]!.role).toBe('assistant');
    expect(c.messages[1]!.content).toContain('different shape');
  });

  it('drops messages with empty text AND empty content blocks', () => {
    const raw = JSON.stringify([
      {
        uuid: 'c1',
        name: 'n',
        created_at: '2026-01-01',
        chat_messages: [{ sender: 'human', text: '' }, { sender: 'assistant', content: [] }],
      },
    ]);
    expect(new ClaudeImporter().parse(raw)).toEqual([]);
  });
});

describe('GeminiImporter', () => {
  it('splits activities into conversations by 30-min gaps', () => {
    const convs = new GeminiImporter().parse(fixture('gemini.myactivity.json'));
    expect(convs.length).toBe(2); // 12:00 group + 18:00 group
    expect(convs[0]!.messages.length).toBe(2);
    expect(convs[1]!.messages.length).toBe(1);
  });

  it('tags "Used Gemini:" prefixed entries as user messages', () => {
    const convs = new GeminiImporter().parse(fixture('gemini.myactivity.json'));
    const roles = convs[0]!.messages.map((m) => m.role);
    expect(roles[0]).toBe('user');
    expect(roles[1]).toBe('assistant');
  });
});

describe('GenericImporter', () => {
  it('parses the generic shape', () => {
    const convs = new GenericImporter().parse(fixture('generic.json'));
    expect(convs).toHaveLength(1);
    expect(convs[0]!.externalId).toBe('gen-1');
    expect(convs[0]!.messages.length).toBe(2);
  });

  it('accepts a bare array as well', () => {
    const raw = JSON.stringify([
      { title: 'Bare', startedAt: 1700000000000, messages: [{ role: 'user', content: 'hi', ts: 1700000000000 }] },
    ]);
    expect(new GenericImporter().parse(raw)).toHaveLength(1);
  });

  it('rejects missing title', () => {
    const raw = JSON.stringify([{ messages: [] }]);
    expect(() => new GenericImporter().parse(raw)).toThrow(ImporterParseError);
  });

  it('rejects missing messages array', () => {
    const raw = JSON.stringify([{ title: 'x' }]);
    expect(() => new GenericImporter().parse(raw)).toThrow(ImporterParseError);
  });
});

describe('resolveImporter', () => {
  it('returns the right concrete importer per kind', () => {
    expect(resolveImporter('chatgpt').source).toBe('chatgpt');
    expect(resolveImporter('claude').source).toBe('claude');
    expect(resolveImporter('gemini').source).toBe('gemini');
    expect(resolveImporter('json').source).toBe('generic');
  });
});
