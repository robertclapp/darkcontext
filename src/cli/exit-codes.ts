import {
  AuthError,
  ConfigError,
  DarkContextError,
  NotFoundError,
  ScopeDeniedError,
  ValidationError,
} from '../core/errors.js';

/**
 * Sysexits-style mapping from a thrown value to a shell exit code. Pulled
 * out of `cli/index.ts` so tests can import the canonical mapper instead
 * of duplicating it (duplicating silently tolerates drift between the
 * production behavior and the fixture).
 *
 * Codes:
 *   64 EX_USAGE     — ValidationError     (bad arguments, malformed input)
 *   66 EX_NOINPUT   — NotFoundError       (requested entity missing)
 *   77 EX_NOPERM    — AuthError           (bearer missing / invalid / unknown)
 *                    | ScopeDeniedError   (tool cannot read/write that scope)
 *   78 EX_CONFIG    — ConfigError         (env / store / schema wrong)
 *    1 — any other DarkContextError subtype
 *    2 — unexpected (bug or upstream failure)
 */
export function exitCodeFor(err: unknown): number {
  if (err instanceof ValidationError) return 64;
  if (err instanceof NotFoundError) return 66;
  if (err instanceof AuthError) return 77;
  if (err instanceof ScopeDeniedError) return 77;
  if (err instanceof ConfigError) return 78;
  if (err instanceof DarkContextError) return 1;
  return 2;
}

/**
 * Format an error for stderr. For typed DarkContextErrors we prefix with
 * the class name so integrators scripting against `dcx` can distinguish
 * "this tool doesn't exist" from "you passed bad arguments" without
 * parsing free-form messages.
 */
export function formatError(err: unknown): string {
  if (err instanceof DarkContextError) return `${err.name}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
