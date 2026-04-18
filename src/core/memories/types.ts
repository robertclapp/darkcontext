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
