import type { ImportedConversation, ImportedMessage } from '../conversations/types.js';
import { Importer, ImporterParseError, toEpochMs } from './importer.js';

interface RawActivity {
  title?: string;
  titleUrl?: string;
  time?: string;
  header?: string;
  details?: Array<{ name?: string }>;
  products?: string[];
  // Gemini-specific fields observed in Takeout activity exports.
  subtitles?: Array<{ name?: string; url?: string }>;
  description?: string;
}

/**
 * Google Takeout "MyActivity.json" importer for Gemini. The JSON shape is a
 * flat array of activity entries; each entry represents either a user prompt
 * (`title` starts with "Used Gemini" / contains the prompt) or a response.
 *
 * Real Takeout exports are rarely clean — this importer groups by time window
 * and treats consecutive entries sharing a close timestamp as a single
 * exchange. For richer fidelity, pre-process your Takeout and feed through
 * the `generic` importer.
 */
export class GeminiImporter implements Importer {
  readonly source = 'gemini';

  parse(raw: string): ImportedConversation[] {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      throw new ImporterParseError(`invalid JSON: ${(err as Error).message}`, this.source);
    }
    if (!Array.isArray(data)) {
      throw new ImporterParseError(
        'expected a top-level array (Takeout MyActivity.json format)',
        this.source
      );
    }

    const activities = data as RawActivity[];
    const messages: ImportedMessage[] = [];
    for (const a of activities) {
      const text = extractText(a);
      if (!text) continue;
      messages.push({
        role: a.title?.startsWith('Used Gemini') ? 'user' : 'assistant',
        content: text,
        ts: toEpochMs(a.time ?? null),
      });
    }
    if (messages.length === 0) return [];

    // Sort chronologically, then bucket into conversations by 30-minute gaps.
    messages.sort((a, b) => a.ts - b.ts);
    const conversations: ImportedConversation[] = [];
    const GAP_MS = 30 * 60 * 1000;
    let current: ImportedMessage[] = [];
    let lastTs = -Infinity;
    for (const m of messages) {
      if (current.length > 0 && m.ts - lastTs > GAP_MS) {
        conversations.push(packConversation(current));
        current = [];
      }
      current.push(m);
      lastTs = m.ts;
    }
    if (current.length > 0) conversations.push(packConversation(current));
    return conversations;
  }
}

function extractText(a: RawActivity): string {
  // Gemini activity title often is the prompt itself (sometimes prefixed).
  if (typeof a.title === 'string') {
    const cleaned = a.title.replace(/^Used Gemini:\s*/i, '').trim();
    if (cleaned.length > 0) return cleaned;
  }
  if (typeof a.description === 'string' && a.description.trim()) return a.description.trim();
  return '';
}

function packConversation(messages: ImportedMessage[]): ImportedConversation {
  const first = messages[0]!;
  const title = first.content.slice(0, 60).replace(/\s+/g, ' ') || '(Gemini session)';
  return {
    title,
    startedAt: first.ts,
    messages,
  };
}
