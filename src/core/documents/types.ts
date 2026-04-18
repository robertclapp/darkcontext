export interface Document {
  id: number;
  title: string;
  sourceUri: string | null;
  mime: string;
  scope: string | null;
  ingestedAt: number;
}

export interface IngestInput {
  title: string;
  content: string;
  sourceUri?: string;
  mime?: string;
  scope?: string;
}

export interface DocumentChunkHit {
  documentId: number;
  title: string;
  scope: string | null;
  chunkIdx: number;
  content: string;
  score: number;
  match: 'vector' | 'keyword';
}

export interface IngestResult {
  document: Document;
  chunks: number;
}

export interface SearchOptions {
  limit?: number;
  scope?: string;
}
