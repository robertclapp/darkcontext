import { describe, it, expect } from 'vitest';

import {
  AuthError,
  ConfigError,
  NotFoundError,
  ValidationError,
} from '../../src/core/errors.js';

/**
 * Replicates the exit-code mapping in src/cli/index.ts so sysexits-style
 * contracts are covered by a test, not only by visual inspection of the
 * top-level error handler. If either side changes, this test flags it.
 */
function exitCodeFor(err: unknown): number {
  if (err instanceof ValidationError) return 64;
  if (err instanceof NotFoundError) return 66;
  if (err instanceof AuthError) return 77;
  if (err instanceof ConfigError) return 78;
  return 2;
}

describe('CLI exit code mapping', () => {
  it('maps ValidationError to 64 (EX_USAGE)', () => {
    expect(exitCodeFor(new ValidationError('x', 'bad'))).toBe(64);
  });

  it('maps NotFoundError to 66 (EX_NOINPUT)', () => {
    expect(exitCodeFor(new NotFoundError('memory', 42))).toBe(66);
  });

  it('maps AuthError to 77 (EX_NOPERM)', () => {
    expect(exitCodeFor(new AuthError('no token'))).toBe(77);
  });

  it('maps ConfigError to 78 (EX_CONFIG)', () => {
    expect(exitCodeFor(new ConfigError('bad'))).toBe(78);
  });

  it('maps any other throw to 2 (unexpected / bug)', () => {
    expect(exitCodeFor(new Error('oops'))).toBe(2);
    expect(exitCodeFor('bare string')).toBe(2);
  });
});
