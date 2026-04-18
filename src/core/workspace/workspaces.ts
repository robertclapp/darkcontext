import type { DarkContextDb } from '../store/db.js';
import { resolveScopeOrDefault } from '../store/scopeHelpers.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { DEFAULT_WORKSPACE_ITEM_STATE } from '../constants.js';

import type {
  NewWorkspace,
  NewWorkspaceItem,
  Workspace,
  WorkspaceItem,
} from './types.js';

interface WsRow {
  id: number;
  name: string;
  is_active: number;
  scope_name: string | null;
  created_at: number;
}

interface ItemRow {
  id: number;
  workspace_id: number;
  kind: string;
  content: string;
  state: string;
  updated_at: number;
}

const WS_SELECT = `
  SELECT w.id, w.name, w.is_active, s.name AS scope_name, w.created_at
  FROM workspaces w
  LEFT JOIN scopes s ON s.id = w.scope_id
`;

export class Workspaces {
  constructor(private readonly db: DarkContextDb) {}

  create(input: NewWorkspace): Workspace {
    if (!input.name.trim()) throw new ValidationError('name', 'workspace name is required');
    if (this.getByName(input.name)) throw new ConflictError('workspace', input.name);
    const scopeId = resolveScopeOrDefault(this.db.raw, input.scope);
    const now = Date.now();
    const info = this.db.raw
      .prepare('INSERT INTO workspaces (name, is_active, scope_id, created_at) VALUES (?, 0, ?, ?)')
      .run(input.name, scopeId, now);
    return this.getById(Number(info.lastInsertRowid));
  }

  list(opts: { scope?: string } = {}): Workspace[] {
    const rows = opts.scope
      ? (this.db.raw
          .prepare(`${WS_SELECT} WHERE s.name = ? ORDER BY w.created_at DESC`)
          .all(opts.scope) as WsRow[])
      : (this.db.raw
          .prepare(`${WS_SELECT} ORDER BY w.created_at DESC`)
          .all() as WsRow[]);
    return rows.map(rowToWs);
  }

  getById(id: number): Workspace {
    const row = this.db.raw.prepare(`${WS_SELECT} WHERE w.id = ?`).get(id) as WsRow | undefined;
    if (!row) throw new NotFoundError('workspace', id);
    return rowToWs(row);
  }

  getByName(name: string): Workspace | null {
    const row = this.db.raw.prepare(`${WS_SELECT} WHERE w.name = ?`).get(name) as WsRow | undefined;
    return row ? rowToWs(row) : null;
  }

  getActive(opts: { scope?: string } = {}): Workspace | null {
    const row = opts.scope
      ? (this.db.raw
          .prepare(`${WS_SELECT} WHERE w.is_active = 1 AND s.name = ?`)
          .get(opts.scope) as WsRow | undefined)
      : (this.db.raw.prepare(`${WS_SELECT} WHERE w.is_active = 1`).get() as WsRow | undefined);
    return row ? rowToWs(row) : null;
  }

  setActive(name: string): Workspace {
    const target = this.getByName(name);
    if (!target) throw new NotFoundError('workspace', name);
    const tx = this.db.raw.transaction(() => {
      this.db.raw.prepare('UPDATE workspaces SET is_active = 0').run();
      this.db.raw.prepare('UPDATE workspaces SET is_active = 1 WHERE id = ?').run(target.id);
    });
    tx();
    return this.getById(target.id);
  }

  remove(name: string): boolean {
    const res = this.db.raw.prepare('DELETE FROM workspaces WHERE name = ?').run(name);
    return res.changes > 0;
  }

  /**
   * Resolve the target workspace for an `add_to_workspace`-style call:
   * explicit id when given, otherwise the active workspace. Returns null
   * if neither is available (kept out of addItem so callers can apply
   * scope checks before writing).
   */
  resolveTarget(workspaceId: number | undefined): Workspace | null {
    if (workspaceId !== undefined) {
      try {
        return this.getById(workspaceId);
      } catch {
        return null;
      }
    }
    return this.getActive();
  }

  addItem(workspaceId: number, item: NewWorkspaceItem): WorkspaceItem {
    const now = Date.now();
    const info = this.db.raw
      .prepare(
        `INSERT INTO workspace_items (workspace_id, kind, content, state, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(workspaceId, item.kind, item.content, item.state ?? DEFAULT_WORKSPACE_ITEM_STATE, now);
    const row = this.db.raw
      .prepare('SELECT id, workspace_id, kind, content, state, updated_at FROM workspace_items WHERE id = ?')
      .get(Number(info.lastInsertRowid)) as ItemRow;
    return rowToItem(row);
  }

  listItems(workspaceId: number, opts: { state?: string } = {}): WorkspaceItem[] {
    const rows = opts.state
      ? (this.db.raw
          .prepare('SELECT id, workspace_id, kind, content, state, updated_at FROM workspace_items WHERE workspace_id = ? AND state = ? ORDER BY updated_at DESC')
          .all(workspaceId, opts.state) as ItemRow[])
      : (this.db.raw
          .prepare('SELECT id, workspace_id, kind, content, state, updated_at FROM workspace_items WHERE workspace_id = ? ORDER BY updated_at DESC')
          .all(workspaceId) as ItemRow[]);
    return rows.map(rowToItem);
  }
}

function rowToWs(row: WsRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active === 1,
    scope: row.scope_name,
    createdAt: row.created_at,
  };
}

function rowToItem(row: ItemRow): WorkspaceItem {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    kind: row.kind,
    content: row.content,
    state: row.state,
    updatedAt: row.updated_at,
  };
}

