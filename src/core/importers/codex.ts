import type { ImportedConversation, ImportedMessage } from '../conversations/types.js';
import { Importer, toEpochMs } from './importer.js';
import { deriveTitle, extractText, parseJsonlLines } from './agentSession.js';

interface CodexLine {
  type?: string;
  role?: string;
  content?: unknown;
  timestamp?: string | number;
  // Newer Codex rollouts wrap the real event under `payload`.
  payload?: { type?: string; id?: string; role?: string; content?: unknown };
  // Session-meta lines carry an id at top level or under payload.
  id?: string;
}

/**
 * Codex CLI session importer. Codex persists a session "rollout" as JSONL at
 * `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl`. The schema has shifted
 * across versions — some lines are bare `{type:'message', role, content}`,
 * newer ones wrap the event as `{type:'response_item', payload:{...}}`, and a
 * leading `session_meta` line carries the session id. We unwrap `payload`
 * when present and keep any line that resolves to a user/assistant message
 * with text; `content` is a string or an array of `{type:'input_text'|
 * 'output_text'|'text', text}` blocks.
 *
 * One file = one conversation. `externalId` is the session id when the
 * rollout records one, for idempotent re-import.
 */
export class CodexImporter implements Importer {
  readonly source = 'codex';

  parse(raw: string): ImportedConversation[] {
    const lines = parseJsonlLines(raw) as CodexLine[];
    const messages: ImportedMessage[] = [];
    let sessionId: string | undefined;
    let firstUserText: string | undefined;

    for (const line of lines) {
      // Unwrap the newer `payload` envelope; fall back to the line itself.
      const ev = (line.payload ?? line) as CodexLine & { role?: string; content?: unknown };

      // Capture a session id from a meta line (either shape) once.
      // The condition is intentionally tight: a plain message event can
      // carry a top-level `id` (Anthropic-style response shapes) and
      // would otherwise win the `!sessionId` race against the real
      // `session_meta` line, silently clobbering the correct id.
      if (!sessionId) {
        const isMeta = line.type === 'session_meta' || ev.type === 'session_meta';
        const id = line.payload?.id ?? line.id;
        if (isMeta && typeof id === 'string') {
          sessionId = id;
        }
      }

      const role = ev.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const text = extractText(ev.content);
      if (!text) continue;
      if (role === 'user' && firstUserText === undefined) firstUserText = text;
      messages.push({ role, content: text, ts: toEpochMs(line.timestamp ?? null) });
    }

    if (messages.length === 0) return [];
    // JSONL append order isn't guaranteed to be chronological — Codex
    // rollouts can interleave a session_meta line with a later timestamp
    // ahead of an earlier message event. Use the actual min ts so
    // history-search "newest first" sorts and time-bounded queries get a
    // truthful start. `reduce` instead of `Math.min(...spread)` to avoid
    // the argument-count limit on long rollouts.
    const startedAt = messages.reduce((m, x) => (x.ts < m ? x.ts : m), messages[0]!.ts);
    return [
      {
        ...(sessionId ? { externalId: sessionId } : {}),
        title: deriveTitle(firstUserText, sessionId ? `Codex ${sessionId.slice(0, 8)}` : 'Codex session'),
        startedAt,
        messages,
      },
    ];
  }
}
