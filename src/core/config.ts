import { homedir } from 'node:os';
import { join } from 'node:path';

import { ConfigError } from './errors.js';
import type { ProviderKind } from './embeddings/index.js';
import type { LLMProviderKind } from './llm/index.js';

/**
 * Canonical resolver for DarkContext configuration.
 *
 * Previously every file that needed an env var read it directly
 * (`process.env.OLLAMA_URL`, `process.env.DARKCONTEXT_TOKEN`, ...). That
 * scattered precedence rules and made overrides in tests awkward. This
 * module is now the single place that:
 *
 *   - reads env vars
 *   - applies defaults
 *   - exposes a typed `Config` shape the rest of the code depends on
 *
 * Tests build a Config from a literal. Production calls `Config.fromEnv()`.
 */

export interface ConfigInit {
  /** Override the storage root. Default: $DARKCONTEXT_HOME or ~/.darkcontext. */
  home?: string;
  /** Override the default store path. Default: `${home}/store.db`. */
  dbPath?: string;
  /** Default embedding provider. Default: $DARKCONTEXT_EMBEDDINGS or 'stub'. */
  embeddings?: ProviderKind;
  /** Bearer token for stdio/http auth. Default: $DARKCONTEXT_TOKEN. */
  token?: string;
  /** SQLCipher key. Default: $DARKCONTEXT_ENCRYPTION_KEY. */
  encryptionKey?: string;
  /** Generative LLM provider for `summarize` and similar features. */
  llm?: { kind?: LLMProviderKind; model?: string };
  ollama?: { url?: string; model?: string };
  onnx?: { model?: string };
}

export interface Config {
  readonly home: string;
  readonly dbPath: string;
  readonly embeddings: ProviderKind;
  readonly token: string | undefined;
  readonly encryptionKey: string | undefined;
  readonly llm: { kind: LLMProviderKind; model: string };
  readonly ollama: { url: string; model: string };
  readonly onnx: { model: string };
}

const PROVIDER_KINDS: readonly ProviderKind[] = ['stub', 'ollama', 'onnx'];
const LLM_PROVIDER_KINDS: readonly LLMProviderKind[] = ['stub', 'ollama'];

function parseProviderKind(raw: string | undefined, fallback: ProviderKind = 'stub'): ProviderKind {
  if (!raw) return fallback;
  const v = raw.toLowerCase();
  if ((PROVIDER_KINDS as readonly string[]).includes(v)) return v as ProviderKind;
  throw new ConfigError(`DARKCONTEXT_EMBEDDINGS: unknown provider '${raw}' (expected stub | ollama | onnx)`);
}

function parseLLMProviderKind(
  raw: string | undefined,
  fallback: LLMProviderKind = 'stub'
): LLMProviderKind {
  if (!raw) return fallback;
  const v = raw.toLowerCase();
  if ((LLM_PROVIDER_KINDS as readonly string[]).includes(v)) return v as LLMProviderKind;
  throw new ConfigError(`DARKCONTEXT_LLM: unknown provider '${raw}' (expected stub | ollama)`);
}

/** Build a `Config` from process.env plus optional overrides (overrides win). */
export function loadConfig(overrides: ConfigInit = {}, env: NodeJS.ProcessEnv = process.env): Config {
  const home = overrides.home ?? env.DARKCONTEXT_HOME ?? join(homedir(), '.darkcontext');
  // Explicit --db / overrides.dbPath wins; then DARKCONTEXT_DB_PATH;
  // finally the conventional ${home}/store.db. The env var lets operators
  // relocate the store without setting a full home directory.
  const dbPath = overrides.dbPath ?? env.DARKCONTEXT_DB_PATH ?? join(home, 'store.db');
  const embeddings = overrides.embeddings ?? parseProviderKind(env.DARKCONTEXT_EMBEDDINGS);
  const llmKind = overrides.llm?.kind ?? parseLLMProviderKind(env.DARKCONTEXT_LLM);
  const llmModel = overrides.llm?.model ?? env.DARKCONTEXT_LLM_MODEL ?? 'llama3.2';
  return {
    home,
    dbPath,
    embeddings,
    token: overrides.token ?? env.DARKCONTEXT_TOKEN,
    encryptionKey: overrides.encryptionKey ?? env.DARKCONTEXT_ENCRYPTION_KEY,
    llm: { kind: llmKind, model: llmModel },
    ollama: {
      url: (overrides.ollama?.url ?? env.OLLAMA_URL ?? 'http://localhost:11434').replace(/\/$/, ''),
      model: overrides.ollama?.model ?? env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text',
    },
    onnx: {
      model: overrides.onnx?.model ?? env.DARKCONTEXT_ONNX_MODEL ?? 'Xenova/all-MiniLM-L6-v2',
    },
  };
}
