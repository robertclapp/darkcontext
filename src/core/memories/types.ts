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
  scope?: string;
}

/**
 * Outcome of `Memories.rememberOrMerge`. `merged: true` means the incoming
 * content was absorbed into an existing near-duplicate in the same scope —
 * `memory` is the (possibly updated) existing row. `merged: false` means a
 * fresh row was inserted and `memory` is the new one.
 */
export interface RememberOrMergeResult {
  memory: Memory;
  merged: boolean;
}
