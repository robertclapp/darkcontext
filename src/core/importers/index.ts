import { ChatGPTImporter } from './chatgpt.js';
import { ClaudeImporter } from './claude.js';
import { GeminiImporter } from './gemini.js';
import { GenericImporter } from './generic.js';
import type { Importer } from './importer.js';

export type ImporterKind = 'chatgpt' | 'claude' | 'gemini' | 'json';

export function resolveImporter(kind: ImporterKind): Importer {
  switch (kind) {
    case 'chatgpt': return new ChatGPTImporter();
    case 'claude':  return new ClaudeImporter();
    case 'gemini':  return new GeminiImporter();
    case 'json':    return new GenericImporter();
  }
}

export {
  ChatGPTImporter,
  ClaudeImporter,
  GeminiImporter,
  GenericImporter,
};
export { ImporterParseError } from './importer.js';
export type { Importer } from './importer.js';
