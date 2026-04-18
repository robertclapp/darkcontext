import { describe, it, expect } from 'vitest';

import {
  AuthError,
  ConfigError,
  DarkContextError,
  NotFoundError,
  ScopeDeniedError,
  ValidationError,
} from '../../src/core/errors.js';
import { exitCodeFor } from '../../src/cli/exit-codes.js';

/**
 * Covers the production `exitCodeFor` mapper directly. Previously the
 * test kept its own copy, which could silently drift from the real CLI
 * behavior; importing the shared module is the only way to guarantee
 * the two stay in lockstep.
 */

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

  it('maps ScopeDeniedError to 77 (EX_NOPERM) — permission-denied shares the AuthError code', () => {
    expect(exitCodeFor(new ScopeDeniedError('no access', 'read', 'alice'))).toBe(77);
  });

  it('maps ConfigError to 78 (EX_CONFIG)', () => {
    expect(exitCodeFor(new ConfigError('bad'))).toBe(78);
  });

  it('maps a plain DarkContextError subtype to 1 (generic domain error)', () => {
    class GenericDomainError extends DarkContextError {}
    expect(exitCodeFor(new GenericDomainError('x'))).toBe(1);
  });

  it('maps any other throw to 2 (unexpected / bug)', () => {
    expect(exitCodeFor(new Error('oops'))).toBe(2);
    expect(exitCodeFor('bare string')).toBe(2);
  });
});
