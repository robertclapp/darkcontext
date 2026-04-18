import type { DarkContextDb } from '../store/db.js';
import type { ToolWithGrants } from '../tools/index.js';
import { AUDIT_REDACTION_CONTEXT, AUDIT_REDACTION_LIMIT } from '../constants.js';

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
 * Redact `args` before they land in the audit log.
 *
 * Policy is **fail-closed**: every string value longer than
 * `AUDIT_REDACTION_LIMIT` is replaced with a short summary regardless of
 * what key it lives under. This prevents a future MCP tool that names a
 * field `prompt`, `message`, or `notes` from silently leaking private
 * content into `audit_log.args_json`.
 *
 * Short strings (enums, scope names, kinds, ids-as-strings) pass through
 * verbatim because they carry operational information the auditor actually
 * needs.
 *
 * Arrays of strings are handled element-wise so a `tags: ['personal']`
 * array survives but an array of chunk bodies would not.
 */
export function redactArgs(args: unknown): unknown {
  if (args === null || args === undefined) return args;
  if (typeof args === 'string') return redactString(args);
  if (typeof args !== 'object') return args;
  if (Array.isArray(args)) return args.map((v) => redactArgs(v));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    out[k] = redactArgs(v);
  }
  return out;
}

function redactString(s: string): string {
  if (s.length <= AUDIT_REDACTION_LIMIT) return s;
  const trimmed = s.trim();
  if (trimmed.length === 0) return '<empty>';
  const c = AUDIT_REDACTION_CONTEXT;
  return `<${trimmed.length}c> ${trimmed.slice(0, c)}… ${trimmed.slice(-c)}`;
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
