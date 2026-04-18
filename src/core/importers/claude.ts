import type { ImportedConversation, ImportedMessage } from '../conversations/types.js';
import { Importer, ImporterParseError, toEpochMs } from './importer.js';

interface RawMessage {
  uuid?: string;
  sender?: string;
  text?: string;
  content?: unknown;
  created_at?: string | number;
}

interface RawConversation {
  uuid?: string;
  name?: string;
  created_at?: string | number;
  chat_messages?: RawMessage[];
  messages?: RawMessage[];
}

/**
 * Claude export importer. Targets the official "Data Export" JSON shape:
 * a top-level array of conversations, each with `uuid`, `name`, `created_at`,
 * and a `chat_messages` array (older exports use `messages`). Message content
 * is taken from `text`, or from `content` if `content` is an array of
 * text blocks like `[{ type: 'text', text: '...' }]`.
 */
export class ClaudeImporter implements Importer {
  readonly source = 'claude';

  parse(raw: string): ImportedConversation[] {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new ImporterParseError(`invalid JSON: ${(err as Error).message}`, this.source);
    }
    if (!Array.isArray(data)) {
      throw new ImporterParseError(
        'expected a top-level array of conversations',
        this.source
      );
    }

    const out: ImportedConversation[] = [];
    for (const item of data as RawConversation[]) {
      const rawMessages = item.chat_messages ?? item.messages ?? [];
      const messages: ImportedMessage[] = [];
      for (const m of rawMessages) {
        const text = extractText(m);
        if (!text) continue;
        messages.push({
          role: normalizeRole(m.sender),
          content: text,
          ts: toEpochMs(m.created_at ?? null),
        });
      }
      if (messages.length === 0) continue;
      out.push({
        ...(item.uuid ? { externalId: item.uuid } : {}),
        title: (item.name ?? '(untitled conversation)').trim() || '(untitled conversation)',
        startedAt: toEpochMs(item.created_at ?? messages[0]?.ts),
        messages,
      });
    }
    return out;
  }
}

function extractText(m: RawMessage): string {
  if (typeof m.text === 'string' && m.text.trim().length > 0) return m.text.trim();
  if (Array.isArray(m.content)) {
    const parts: string[] = [];
    for (const block of m.content as Array<{ type?: string; text?: string }>) {
      if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    }
    const joined = parts.join('\n').trim();
    if (joined) return joined;
  }
  return '';
}

function normalizeRole(sender?: string): string {
  const s = (sender ?? '').toLowerCase();
  if (s === 'human' || s === 'user') return 'user';
  if (s === 'assistant' || s === 'claude') return 'assistant';
  return s || 'assistant';
}
