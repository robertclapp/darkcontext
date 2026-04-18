// Public entry point. Third-party consumers should import named symbols
// from here — file paths under `src/core/*` and `src/mcp/*` are
// implementation detail and may move without notice.

// Application wiring
export { AppContext, type ContextInit } from './core/context.js';
export { loadConfig, type Config, type ConfigInit } from './core/config.js';

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

// Errors (the whole hierarchy so consumers can match by type)
export {
  DarkContextError,
  NotFoundError,
  ConflictError,
  ValidationError,
  AuthError,
  ConfigError,
  ImporterParseError,
  ScopeDeniedError,
} from './core/errors.js';

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
} from './core/importers/index.js';
export type { Importer, ImporterKind } from './core/importers/index.js';

// Embeddings
export {
  createEmbeddingProvider,
  StubEmbeddingProvider,
  OllamaEmbeddingProvider,
  OnnxEmbeddingProvider,
} from './core/embeddings/index.js';
export type { EmbeddingProvider, ProviderKind } from './core/embeddings/index.js';

// MCP server (transport + security boundary)
export { buildServer, startStdioServer } from './mcp/server.js';
export { startHttpServer } from './mcp/httpServer.js';
export { ScopeFilter } from './mcp/scopeFilter.js';
export { withAudit } from './mcp/audit.js';
export { ALL_MCP_TOOLS, registerAllMcpTools } from './mcp/tools/registry.js';
export { defineTool, type McpToolDef, type McpToolContext } from './mcp/tools/types.js';
