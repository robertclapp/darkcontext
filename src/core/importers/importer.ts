import type { ImportedConversation } from '../conversations/types.js';
import { ImporterParseError } from '../errors.js';

export interface Importer {
  /** Stable source label stored on each conversation row. */
  readonly source: string;
  /**
   * Parse the exporter's raw format (a string — typically file contents) into
   * our normalized conversation shape. Implementations MUST be pure: no I/O,
   * no DB. Errors should describe what was expected vs. what was seen so
   * operators can fix their export or pre-process it.
   */
  parse(raw: string): ImportedConversation[];
}

export { ImporterParseError };

export function toEpochMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // ChatGPT uses epoch seconds (float), Claude uses ISO, Gemini varies.
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string' && value.length > 0) {
    const s = value.trim();
    // Digit-only strings (e.g. "1700000000") fail Date.parse and would
    // otherwise fall through to Date.now(), corrupting import timestamps.
    if (/^\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n)) return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
    }
    const parsed = Date.parse(s);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}
