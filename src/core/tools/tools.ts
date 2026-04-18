import type { DarkContextDb } from '../store/db.js';
import { Scopes } from '../scopes/scopes.js';

import type { NewToolInput, ProvisionedTool, Tool, ToolGrant, ToolWithGrants } from './types.js';
import { generateToken, hashToken } from './tokens.js';

interface ToolRow {
  id: number;
  name: string;
  created_at: number;
  last_seen_at: number | null;
}

interface GrantRow {
  scope_name: string;
  can_read: number;
  can_write: number;
}

export class Tools {
  private readonly scopes: Scopes;

  constructor(private readonly db: DarkContextDb) {
    this.scopes = new Scopes(db);
  }

  create(input: NewToolInput): ProvisionedTool {
    if (!input.name.trim()) throw new Error('tool name is required');
    if (input.scopes.length === 0) throw new Error('at least one scope is required');

    const existing = this.findByName(input.name);
    if (existing) throw new Error(`tool already exists: ${input.name}`);

    const token = generateToken();
    const tokenHash = hashToken(token);
    const now = Date.now();

    const tx = this.db.raw.transaction(() => {
      const info = this.db.raw
        .prepare('INSERT INTO tools (name, token_hash, created_at) VALUES (?, ?, ?)')
        .run(input.name, tokenHash, now);
      const toolId = Number(info.lastInsertRowid);

      for (const scopeName of input.scopes) {
        const scope = this.scopes.upsert(scopeName);
        this.db.raw
          .prepare(
            `INSERT INTO tool_scopes (tool_id, scope_id, can_read, can_write)
             VALUES (?, ?, 1, ?)`
          )
          .run(toolId, scope.id, input.readOnly ? 0 : 1);
      }
      return toolId;
    });

    const toolId = tx() as number;
    const tool = this.getById(toolId);
    return { tool, token, grants: this.grantsFor(toolId) };
  }

  list(): ToolWithGrants[] {
    const rows = this.db.raw
      .prepare('SELECT id, name, created_at, last_seen_at FROM tools ORDER BY name')
      .all() as ToolRow[];
    return rows.map((r) => ({ ...rowToTool(r), grants: this.grantsFor(r.id) }));
  }

  findByName(name: string): Tool | null {
    const row = this.db.raw
      .prepare('SELECT id, name, created_at, last_seen_at FROM tools WHERE name = ?')
      .get(name) as ToolRow | undefined;
    return row ? rowToTool(row) : null;
  }

  getById(id: number): Tool {
    const row = this.db.raw
      .prepare('SELECT id, name, created_at, last_seen_at FROM tools WHERE id = ?')
      .get(id) as ToolRow | undefined;
    if (!row) throw new Error(`tool ${id} not found`);
    return rowToTool(row);
  }

  grantsFor(toolId: number): ToolGrant[] {
    const rows = this.db.raw
      .prepare(
        `SELECT s.name AS scope_name, ts.can_read, ts.can_write
         FROM tool_scopes ts
         JOIN scopes s ON s.id = ts.scope_id
         WHERE ts.tool_id = ?
         ORDER BY s.name`
      )
      .all(toolId) as GrantRow[];
    return rows.map((r) => ({
      scope: r.scope_name,
      canRead: r.can_read === 1,
      canWrite: r.can_write === 1,
    }));
  }

  authenticate(token: string): ToolWithGrants | null {
    const hash = hashToken(token);
    const row = this.db.raw
      .prepare('SELECT id, name, created_at, last_seen_at FROM tools WHERE token_hash = ?')
      .get(hash) as ToolRow | undefined;
    if (!row) return null;
    const now = Date.now();
    this.db.raw.prepare('UPDATE tools SET last_seen_at = ? WHERE id = ?').run(now, row.id);
    return {
      ...rowToTool({ ...row, last_seen_at: now }),
      grants: this.grantsFor(row.id),
    };
  }

  revoke(name: string): boolean {
    const res = this.db.raw.prepare('DELETE FROM tools WHERE name = ?').run(name);
    return res.changes > 0;
  }

  rotateToken(name: string): string {
    const tool = this.findByName(name);
    if (!tool) throw new Error(`tool not found: ${name}`);
    const token = generateToken();
    this.db.raw
      .prepare('UPDATE tools SET token_hash = ? WHERE id = ?')
      .run(hashToken(token), tool.id);
    return token;
  }
}

function rowToTool(row: ToolRow): Tool {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}
