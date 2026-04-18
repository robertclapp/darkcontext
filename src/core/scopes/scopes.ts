import type { DarkContextDb } from '../store/db.js';
import { ValidationError } from '../errors.js';
import { DEFAULT_SCOPE_NAME } from '../constants.js';

export interface Scope {
  id: number;
  name: string;
  description: string | null;
}

export class Scopes {
  constructor(private readonly db: DarkContextDb) {}

  list(): Scope[] {
    return this.db.raw
      .prepare('SELECT id, name, description FROM scopes ORDER BY name')
      .all() as Scope[];
  }

  getByName(name: string): Scope | null {
    const row = this.db.raw
      .prepare('SELECT id, name, description FROM scopes WHERE name = ?')
      .get(name) as Scope | undefined;
    return row ?? null;
  }

  upsert(name: string, description?: string): Scope {
    const normalized = name.trim();
    if (!normalized) throw new ValidationError('name', 'scope name is required');
    const existing = this.getByName(normalized);
    if (existing) {
      // Honor the description if the caller provided one and it differs.
      // Previously this short-circuited, which made the "upsert" name a lie.
      if (description !== undefined && description !== existing.description) {
        this.db.raw
          .prepare('UPDATE scopes SET description = ? WHERE id = ?')
          .run(description, existing.id);
        return { ...existing, description };
      }
      return existing;
    }
    this.db.raw
      .prepare('INSERT INTO scopes (name, description) VALUES (?, ?)')
      .run(normalized, description ?? null);
    const created = this.getByName(normalized);
    if (!created) throw new Error(`failed to create scope: ${normalized}`);
    return created;
  }

  remove(name: string): boolean {
    if (name === DEFAULT_SCOPE_NAME) {
      throw new ValidationError('name', `the '${DEFAULT_SCOPE_NAME}' scope cannot be removed`);
    }
    const res = this.db.raw.prepare('DELETE FROM scopes WHERE name = ?').run(name);
    return res.changes > 0;
  }
}
