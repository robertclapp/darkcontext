import type { DarkContextDb } from '../store/db.js';

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
    const existing = this.getByName(name);
    if (existing) return existing;
    this.db.raw
      .prepare('INSERT INTO scopes (name, description) VALUES (?, ?)')
      .run(name, description ?? null);
    const created = this.getByName(name);
    if (!created) throw new Error(`Failed to create scope: ${name}`);
    return created;
  }

  remove(name: string): boolean {
    if (name === 'default') throw new Error("cannot delete the 'default' scope");
    const res = this.db.raw.prepare('DELETE FROM scopes WHERE name = ?').run(name);
    return res.changes > 0;
  }
}
