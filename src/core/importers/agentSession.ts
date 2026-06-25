/**
 * Shared helpers for agent-CLI session transcripts (Claude Code, Codex).
 *
 * These tools persist a session as a JSONL file — one JSON object per line,
 * an append-only event stream. Parsing is deliberately TOLERANT: real logs
 * contain event types we don't care about (tool calls, reasoning traces,
 * file snapshots), and a crashed session can leave a truncated final line.
 * We skip what we can't read rather than rejecting the whole file, so a
 * single malformed line never costs the user an entire session's history.
 */

/** Parse JSONL into objects, skipping blank and unparseable lines. */
export function parseJsonlLines(raw: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        out.push(obj as Record<string, unknown>);
      }
    } catch {
      // Truncated / non-JSON line — skip it, keep the rest of the session.
    }
  }
  return out;
}

/**
 * Flatten a message `content` field to plain text. Agent CLIs use either a
 * bare string or an array of typed blocks (`{type:'text'|'input_text'|
 * 'output_text', text}`). Non-text blocks (tool_use, image, …) contribute
 * nothing. Returns trimmed text, possibly empty.
 */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block);
    } else if (block && typeof block === 'object') {
      const t = (block as { text?: unknown }).text;
      if (typeof t === 'string') parts.push(t);
    }
  }
  return parts.join('\n').trim();
}

/** Derive a short conversation title from the first user message text. */
export function deriveTitle(firstUserText: string | undefined, fallback: string): string {
  const t = (firstUserText ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return fallback;
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}
