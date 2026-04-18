import { describe, it, expect } from 'vitest';

import {
  DarkContextError,
  NotFoundError,
  ConflictError,
  ValidationError,
  AuthError,
  ConfigError,
  ImporterParseError,
  ScopeDeniedError,
} from '../../src/core/errors.js';

describe('error hierarchy', () => {
  it('every typed error extends DarkContextError', () => {
    const errs = [
      new NotFoundError('x', 1),
      new ConflictError('x', 'y'),
      new ValidationError('x', 'bad'),
      new AuthError('nope'),
      new ConfigError('nope'),
      new ImporterParseError('bad', 'src'),
      new ScopeDeniedError('nope', 'read', 's'),
    ];
    for (const e of errs) {
      expect(e).toBeInstanceOf(DarkContextError);
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe(e.constructor.name);
    }
  });

  it('NotFoundError formats its message from entity + key', () => {
    expect(new NotFoundError('memory', 42).message).toBe('memory not found: 42');
    expect(new NotFoundError('tool', 'alpha').message).toBe('tool not found: alpha');
  });

  it('ConflictError carries entity + key', () => {
    const e = new ConflictError('tool', 'dup');
    expect(e.message).toBe('tool already exists: dup');
    expect(e.entity).toBe('tool');
    expect(e.key).toBe('dup');
  });

  it('ScopeDeniedError carries structured kind + scope', () => {
    const e = new ScopeDeniedError('cannot read s', 'read', 's');
    expect(e.kind).toBe('read');
    expect(e.scope).toBe('s');
  });

  it('preserves `cause` when provided', () => {
    const inner = new Error('inner');
    const e = new ValidationError('x', 'bad');
    // ValidationError doesn't accept cause in its ctor, so check base
    const base = new (class extends DarkContextError {})('wrap', inner);
    expect(base.cause).toBe(inner);
    expect(e.cause).toBeUndefined();
  });
});
