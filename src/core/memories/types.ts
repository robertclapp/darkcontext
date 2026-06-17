export interface Memory {
  id: number;
  content: string;
  kind: string;
  tags: string[];
  scope: string | null;
  source: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewMemory {
  content: string;
  kind?: string;
  tags?: string[];
  scope?: string;
  source?: string;
}

export interface RecallHit {
  memory: Memory;
  score: number;
  match: 'vector' | 'keyword';
}

export interface RecallOptions {
  limit?: number;
  /** Single scope filter (CLI ergonomics). */
  scope?: string;
  /** Explicit scope set — the access layer pushes a tool's full readable
   *  set here so filtering happens in SQL. Wins over `scope`. An empty
   *  array means "no readable scopes" → no results. */
  scopes?: readonly string[];
}
