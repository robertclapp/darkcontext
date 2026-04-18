import { AppContext, type ContextInit } from '../core/context.js';
import type { ProviderKind } from '../core/embeddings/index.js';
import { ValidationError } from '../core/errors.js';

/**
 * Options every CLI subcommand accepts. Translated into a `ContextInit`
 * that `AppContext.open` consumes. Keeping the shape identical across
 * subcommands reduces bespoke plumbing inside each action.
 */
export interface CommonCliOptions {
  db?: string;
  provider?: ProviderKind;
}

/**
 * Open an AppContext, run the action, close on the way out (success or
 * failure). Every CLI action uses this so the try/finally block lives in
 * exactly one place.
 */
export async function withAppContext<T>(
  opts: CommonCliOptions,
  fn: (ctx: AppContext) => Promise<T> | T
): Promise<T> {
  // Use `!== undefined` rather than a truthy check: an explicit `--db ""`
  // or `--provider ""` is a caller bug that loadConfig() / the provider
  // factory should surface, not something we silently replace with the
  // default. Truly unset options remain absent from the ContextInit.
  const init: ContextInit = {
    ...(opts.db !== undefined ? { dbPath: opts.db } : {}),
    ...(opts.provider !== undefined ? { embeddings: opts.provider } : {}),
  };
  return AppContext.run(init, fn);
}

/**
 * Commander's numeric option parser accepts NaN, 0, negatives, and
 * Infinity — all of which are nonsense for a `--limit`. This validator
 * produces a friendly `ValidationError` (exit 64) instead of letting a
 * bogus value reach the SQL layer.
 */
export function parsePositiveInt(name: string): (value: string) => number {
  return (value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      throw new ValidationError(name, `must be a positive integer, got: ${value}`);
    }
    return n;
  };
}
