// Public entry point. Third-party consumers should import named symbols
// from here — file paths under `src/core/*` are implementation detail.

// Storage
export { openDb } from './core/store/db.js';
export type { DarkContextDb, OpenDbOptions } from './core/store/db.js';
export { defaultDbPath, defaultStoreDir } from './core/store/paths.js';
export { VectorIndex } from './core/store/vectorIndex.js';
export {
  resolveScopeId,
  defaultScopeId,
  resolveScopeOrDefault,
} from './core/store/scopeHelpers.js';

// Domains
export { Memories } from './core/memories/index.js';
export type { Memory, NewMemory, RecallHit, RecallOptions } from './core/memories/index.js';

export { Documents, chunkText } from './core/documents/index.js';
export type {
  Document,
  IngestInput,
  IngestResult,
  DocumentChunkHit,
  SearchOptions,
  ChunkOptions,
} from './core/documents/index.js';

export { Workspaces } from './core/workspace/index.js';
export type {
  Workspace,
  WorkspaceItem,
  NewWorkspace,
  NewWorkspaceItem,
} from './core/workspace/index.js';

export { Conversations } from './core/conversations/index.js';
export type {
  Conversation,
  Message,
  ImportedConversation,
  ImportedMessage,
  HistoryHit,
  HistorySearchOptions,
} from './core/conversations/index.js';

// Access control
export { Tools, generateToken, hashToken, looksLikeToken } from './core/tools/index.js';
export type {
  Tool,
  ToolGrant,
  ToolWithGrants,
  NewToolInput,
  ProvisionedTool,
} from './core/tools/index.js';

export { Scopes } from './core/scopes/index.js';
export type { Scope } from './core/scopes/index.js';

// Audit
export { AuditLog, redactArgs } from './core/audit/index.js';
export type { AuditEntry, AuditSink } from './core/audit/index.js';

// Importers
export {
  resolveImporter,
  ChatGPTImporter,
  ClaudeImporter,
  GeminiImporter,
  GenericImporter,
  ImporterParseError,
} from './core/importers/index.js';
export type { Importer, ImporterKind } from './core/importers/index.js';

// Embeddings
export {
  createEmbeddingProvider,
  resolveProviderKind,
  StubEmbeddingProvider,
  OllamaEmbeddingProvider,
  OnnxEmbeddingProvider,
} from './core/embeddings/index.js';
export type { EmbeddingProvider, ProviderKind } from './core/embeddings/index.js';

// MCP
export { buildServer, startStdioServer } from './mcp/server.js';
export { startHttpServer } from './mcp/httpServer.js';
export { ScopeFilter, ScopeDeniedError } from './mcp/scopeFilter.js';
export type { FilterDeps } from './mcp/scopeFilter.js';
export { withAudit } from './mcp/audit.js';
