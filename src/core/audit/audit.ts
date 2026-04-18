import type { DarkContextDb } from '../store/db.js';
import type { ToolWithGrants } from '../tools/index.js';

export interface AuditEntry {
  id: number;
  ts: number;
  toolId: number | null;
  toolName: string;
  mcpTool: string;
  args: unknown;
  outcome: 'ok' | 'denied' | 'error';
  error: string | null;
  durationMs: number;
}

interface AuditRow {
  id: number;
  ts: number;
  tool_id: number | null;
  tool_name: string;
  mcp_tool: string;
  args_json: string;
  outcome: string;
  error: string | null;
  duration_ms: number;
}

export interface AuditSink {
  record(entry: Omit<AuditEntry, 'id'>): void;
}

/**
 * Redaction rules for `args` before they land in the log. We never persist
 * the full `content` of memories/documents/messages — audit needs to describe
 * what happened without becoming a second copy of the private data.
 */
const CONTENT_KEYS = new Set(['content', 'text', 'query', 'body']);

export function redactArgs(args: unknown): unknown {
  if (args === null || typeof args !== 'object') return args;
  if (Array.isArray(args)) return args.map((v) => redactArgs(v));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (CONTENT_KEYS.has(k) && typeof v === 'string') {
      out[k] = summarize(v);
    } else {
      out[k] = redactArgs(v);
    }
  }
  return out;
}

function summarize(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length === 0) return '<empty>';
  // Keep first + last 16 chars, replace the middle with a length marker.
  if (trimmed.length <= 40) return `<${trimmed.length}c>`;
  return `<${trimmed.length}c> ${trimmed.slice(0, 16)}… ${trimmed.slice(-16)}`;
}

export class AuditLog implements AuditSink {
  constructor(private readonly db: DarkContextDb, private readonly caller: ToolWithGrants | null) {}

  record(entry: Omit<AuditEntry, 'id'>): void {
    this.db.raw
      .prepare(
        `INSERT INTO audit_log
           (ts, tool_id, tool_name, mcp_tool, args_json, outcome, error, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.ts,
        entry.toolId,
        entry.toolName,
        entry.mcpTool,
        JSON.stringify(entry.args ?? {}),
        entry.outcome,
        entry.error,
        entry.durationMs
      );
  }

  get callerTool(): ToolWithGrants | null {
    return this.caller;
  }

  list(opts: { limit?: number; toolName?: string; outcome?: string } = {}): AuditEntry[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.toolName) {
      where.push('tool_name = ?');
      params.push(opts.toolName);
    }
    if (opts.outcome) {
      where.push('outcome = ?');
      params.push(opts.outcome);
    }
    const sql = `
      SELECT id, ts, tool_id, tool_name, mcp_tool, args_json, outcome, error, duration_ms
      FROM audit_log
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ts DESC
      LIMIT ?
    `;
    params.push(opts.limit ?? 100);
    const rows = this.db.raw.prepare(sql).all(...params) as AuditRow[];
    return rows.map(rowToEntry);
  }

  prune(beforeTs: number): number {
    const res = this.db.raw.prepare('DELETE FROM audit_log WHERE ts < ?').run(beforeTs);
    return res.changes;
  }
}

function rowToEntry(row: AuditRow): AuditEntry {
  let args: unknown = {};
  try {
    args = JSON.parse(row.args_json);
  } catch {
    args = { _unparseable: row.args_json };
  }
  return {
    id: row.id,
    ts: row.ts,
    toolId: row.tool_id,
    toolName: row.tool_name,
    mcpTool: row.mcp_tool,
    args,
    outcome: row.outcome as AuditEntry['outcome'],
    error: row.error,
    durationMs: row.duration_ms,
  };
}
