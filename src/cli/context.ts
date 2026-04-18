import { AppContext, type ContextInit } from '../core/context.js';
import type { ProviderKind } from '../core/embeddings/index.js';

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
  const init: ContextInit = {
    ...(opts.db ? { dbPath: opts.db } : {}),
    ...(opts.provider ? { embeddings: opts.provider } : {}),
  };
  return AppContext.run(init, fn);
}

export type { AppContext };
