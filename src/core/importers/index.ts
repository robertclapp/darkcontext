import { ChatGPTImporter } from './chatgpt.js';
import { ClaudeImporter } from './claude.js';
import { ClaudeCodeImporter } from './claudeCode.js';
import { CodexImporter } from './codex.js';
import { GeminiImporter } from './gemini.js';
import { GenericImporter } from './generic.js';
import type { Importer } from './importer.js';

export type ImporterKind =
  | 'chatgpt'
  | 'claude'
  | 'claude-code'
  | 'codex'
  | 'gemini'
  | 'generic';

export function resolveImporter(kind: ImporterKind): Importer {
  switch (kind) {
    case 'chatgpt':     return new ChatGPTImporter();
    case 'claude':      return new ClaudeImporter();
    case 'claude-code': return new ClaudeCodeImporter();
    case 'codex':       return new CodexImporter();
    case 'gemini':      return new GeminiImporter();
    case 'generic':     return new GenericImporter();
  }
}

export {
  ChatGPTImporter,
  ClaudeImporter,
  ClaudeCodeImporter,
  CodexImporter,
  GeminiImporter,
  GenericImporter,
};
export { ImporterParseError } from './importer.js';
export type { Importer } from './importer.js';
export type { ImportedConversation, ImportedMessage } from '../conversations/types.js';
