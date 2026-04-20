import type { Config, ConfigInit } from './config.js';
import { loadConfig } from './config.js';
import type { DarkContextDb } from './store/db.js';
import { openDb } from './store/db.js';
import { Memories } from './memories/index.js';
import { Documents } from './documents/index.js';
import { Workspaces } from './workspace/index.js';
import { Conversations } from './conversations/index.js';
import { Scopes } from './scopes/index.js';
import { Tools } from './tools/index.js';
import type { ToolWithGrants } from './tools/index.js';
import { AuditLog } from './audit/index.js';
import type { EmbeddingProvider, ProviderKind } from './embeddings/index.js';
import { createEmbeddingProvider } from './embeddings/index.js';
import type { LLMProvider } from './llm/index.js';
import { createLLMProvider } from './llm/index.js';
import { Summarize } from './summarize/index.js';

/**
 * Application context: the single place that wires the database and all
 * domain modules together. Replaces the ~20 ad-hoc `openDb(...) + new
 * Memories(...) + try/finally` blocks that used to live in every CLI
 * command and transport.
 *
 * Usage:
 *   const ctx = AppContext.open();         // loads env-based config
 *   try { await ctx.memories.remember(...) }
 *   finally { ctx.close() }
 *
 * Or for short-lived units of work:
 *   await AppContext.run({}, async (ctx) => { ... });
 *
 * Tests build a fixture via `AppContext.open({ dbPath, embeddings: 'stub' })`.
 * Nothing else in the codebase should call `openDb` or `createEmbeddingProvider`
 * directly — this is the one seam.
 */
export class AppContext {
  readonly config: Config;
  readonly db: DarkContextDb;
  readonly embeddings: EmbeddingProvider;
  readonly llm: LLMProvider;
  readonly memories: Memories;
  readonly documents: Documents;
  readonly workspaces: Workspaces;
  readonly conversations: Conversations;
  readonly scopes: Scopes;
  readonly tools: Tools;
  readonly summarize: Summarize;

  private closed = false;

  private constructor(params: {
    config: Config;
    db: DarkContextDb;
    embeddings: EmbeddingProvider;
    llm: LLMProvider;
  }) {
    this.config = params.config;
    this.db = params.db;
    this.embeddings = params.embeddings;
    this.llm = params.llm;
    this.memories = new Memories(this.db, this.embeddings);
    this.documents = new Documents(this.db, this.embeddings);
    this.workspaces = new Workspaces(this.db);
    this.conversations = new Conversations(this.db, this.embeddings);
    this.scopes = new Scopes(this.db);
    this.tools = new Tools(this.db);
    this.summarize = new Summarize(this.conversations, this.memories, this.llm);
  }

  /** Open a context from env + optional overrides. Caller owns the lifetime. */
  static open(init: ContextInit = {}): AppContext {
    const config = loadConfig(init);
    const db = openDb({
      path: init.dbPath ?? config.dbPath,
      ...(config.encryptionKey ? { encryptionKey: config.encryptionKey } : {}),
    });

    const providerKind: ProviderKind = init.embeddings ?? config.embeddings;
    const embeddings = createEmbeddingProvider({ kind: providerKind, config });
    const llm = createLLMProvider({ kind: config.llm.kind, config });
    return new AppContext({ config, db, embeddings, llm });
  }

  /** Scoped helper: open a context, run `fn`, close the context. */
  static async run<T>(init: ContextInit, fn: (ctx: AppContext) => Promise<T> | T): Promise<T> {
    const ctx = AppContext.open(init);
    try {
      return await fn(ctx);
    } finally {
      ctx.close();
    }
  }

  /** Build an AuditLog writer bound to this context's DB. */
  newAuditLog(caller: ToolWithGrants | null): AuditLog {
    return new AuditLog(this.db, caller);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

/**
 * Everything a caller might want to override when opening a context. All
 * fields are optional — defaults come from env + `loadConfig`.
 */
export interface ContextInit extends ConfigInit {
  /** Override the DB path (takes precedence over `config.dbPath`). */
  dbPath?: string;
}
