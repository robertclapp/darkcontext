import type { ImportedConversation, ImportedMessage } from '../conversations/types.js';
import { Importer, ImporterParseError, toEpochMs } from './importer.js';

/**
 * Generic JSON importer. Accepts two shapes:
 *
 * 1. `{ "conversations": [Conversation, ...] }`
 * 2. A bare array `[Conversation, ...]`
 *
 * Each `Conversation` must be:
 * ```
 * {
 *   "externalId"?: string,
 *   "title": string,
 *   "startedAt": number | string,     // epoch ms / s, or ISO 8601
 *   "messages": [
 *     { "role": string, "content": string, "ts": number | string }
 *   ]
 * }
 * ```
 *
 * This is the contract operators should map exotic exports onto before
 * running `dcx import json`.
 */
export class GenericImporter implements Importer {
  readonly source = 'generic';

  parse(raw: string): ImportedConversation[] {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new ImporterParseError(`invalid JSON: ${(err as Error).message}`, this.source);
    }
    const arr = Array.isArray(data)
      ? data
      : Array.isArray((data as { conversations?: unknown[] })?.conversations)
        ? (data as { conversations: unknown[] }).conversations
        : null;
    if (!arr) {
      throw new ImporterParseError(
        'expected { conversations: [...] } or a top-level array',
        this.source
      );
    }

    const out: ImportedConversation[] = [];
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i] as Record<string, unknown> | undefined;
      if (!item || typeof item !== 'object') continue;
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      if (!title) throw new ImporterParseError(`conversation[${i}]: missing 'title'`, this.source);
      if (!Array.isArray(item.messages))
        throw new ImporterParseError(`conversation[${i}]: missing 'messages' array`, this.source);

      const messages: ImportedMessage[] = [];
      for (let j = 0; j < item.messages.length; j++) {
        const m = item.messages[j] as Record<string, unknown> | undefined;
        if (!m || typeof m !== 'object') continue;
        const role = typeof m.role === 'string' ? m.role : 'assistant';
        const content = typeof m.content === 'string' ? m.content : '';
        if (!content) continue;
        messages.push({ role, content, ts: toEpochMs(m.ts ?? null) });
      }
      if (messages.length === 0) continue;
      out.push({
        ...(typeof item.externalId === 'string' ? { externalId: item.externalId } : {}),
        title,
        startedAt: toEpochMs(item.startedAt ?? messages[0]?.ts),
        messages,
      });
    }
    return out;
  }
}
