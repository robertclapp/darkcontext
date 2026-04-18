import type { DarkContextDb } from '../store/db.js';
import { ValidationError } from '../errors.js';

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
    if (!name.trim()) throw new ValidationError('name', 'scope name is required');
    const existing = this.getByName(name);
    if (existing) return existing;
    this.db.raw
      .prepare('INSERT INTO scopes (name, description) VALUES (?, ?)')
      .run(name, description ?? null);
    const created = this.getByName(name);
    if (!created) throw new Error(`failed to create scope: ${name}`);
    return created;
  }

  remove(name: string): boolean {
    if (name === 'default') {
      throw new ValidationError('name', "the 'default' scope cannot be removed");
    }
    const res = this.db.raw.prepare('DELETE FROM scopes WHERE name = ?').run(name);
    return res.changes > 0;
  }
}
