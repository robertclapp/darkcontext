export interface Conversation {
  id: number;
  source: string;
  externalId: string | null;
  title: string;
  startedAt: number;
  scope: string | null;
}

export interface Message {
  id: number;
  conversationId: number;
  role: string;
  content: string;
  ts: number;
}

export interface ImportedMessage {
  role: string;
  content: string;
  ts: number;
}

export interface ImportedConversation {
  externalId?: string;
  title: string;
  startedAt: number;
  messages: ImportedMessage[];
}

export interface IngestResult {
  inserted: number;
  skipped: number;
  messages: number;
}

export interface HistoryHit {
  conversationId: number;
  source: string;
  title: string;
  scope: string | null;
  messageId: number;
  role: string;
  content: string;
  ts: number;
  score: number;
  match: 'vector' | 'keyword';
}

export interface HistorySearchOptions {
  limit?: number;
  scope?: string;
  source?: string;
}
