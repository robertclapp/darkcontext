import type { ImportedConversation, ImportedMessage } from '../conversations/types.js';
import { Importer, toEpochMs } from './importer.js';
import { deriveTitle, extractText, parseJsonlLines } from './agentSession.js';

interface ClaudeCodeLine {
  type?: string;
  sessionId?: string;
  timestamp?: string | number;
  message?: { role?: string; content?: unknown };
}

/**
 * Claude Code session importer. Claude Code persists each session as a JSONL
 * transcript at `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`, one
 * event per line. We keep the `user` / `assistant` message events (their
 * `message.content` is a string or an array of text blocks) and skip
 * everything else (summaries, tool results, meta).
 *
 * One file = one session = one conversation. `externalId` is the sessionId
 * so re-importing the same session is a no-op (the conversations table has a
 * UNIQUE(source, external_id) guard).
 */
export class ClaudeCodeImporter implements Importer {
  readonly source = 'claude-code';

  parse(raw: string): ImportedConversation[] {
    const lines = parseJsonlLines(raw) as ClaudeCodeLine[];
    const messages: ImportedMessage[] = [];
    let sessionId: string | undefined;
    let firstUserText: string | undefined;

    for (const line of lines) {
      if (typeof line.sessionId === 'string' && !sessionId) sessionId = line.sessionId;
      // Use the message role exclusively. The line-level `type` field is
      // an event category (e.g. future `user`-as-event-kind), not a chat
      // turn role — relying on it as a fallback would misclassify events
      // that happen to share the literal string.
      const role = line.message?.role;
      if (role !== 'user' && role !== 'assistant') continue;
      const text = extractText(line.message?.content);
      if (!text) continue;
      if (role === 'user' && firstUserText === undefined) firstUserText = text;
      messages.push({ role, content: text, ts: toEpochMs(line.timestamp ?? null) });
    }

    if (messages.length === 0) return [];
    return [
      {
        ...(sessionId ? { externalId: sessionId } : {}),
        title: deriveTitle(firstUserText, sessionId ? `Claude Code ${sessionId.slice(0, 8)}` : 'Claude Code session'),
        startedAt: messages[0]!.ts,
        messages,
      },
    ];
  }
}
