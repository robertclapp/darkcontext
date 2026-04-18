import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { makeFixture, type Fixture } from '../helpers/factory.js';
import { hashToken, looksLikeToken } from '../../src/core/tools/index.js';

describe('Tools', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => fx.cleanup());

  it('provisions a tool, stores only the token hash, and returns plaintext once', () => {
    const result = fx.tools.create({ name: 'claude-desktop', scopes: ['personal', 'work'] });
    expect(result.tool.name).toBe('claude-desktop');
    expect(result.grants.map((g) => g.scope).sort()).toEqual(['personal', 'work']);
    expect(looksLikeToken(result.token)).toBe(true);

    // The plaintext token must not appear in the DB; only its sha256 hash.
    const hashRow = fx.db.raw
      .prepare('SELECT token_hash FROM tools WHERE name = ?')
      .get('claude-desktop') as { token_hash: string };
    expect(hashRow.token_hash).toBe(hashToken(result.token));
    expect(hashRow.token_hash).not.toBe(result.token);
  });

  it('creates read-only grants when --read-only is set', () => {
    const result = fx.tools.create({ name: 'ro', scopes: ['shared'], readOnly: true });
    expect(result.grants[0]!.canRead).toBe(true);
    expect(result.grants[0]!.canWrite).toBe(false);
  });

  it('authenticates a valid token and bumps last_seen_at', () => {
    const { token, tool } = fx.tools.create({ name: 't', scopes: ['a'] });
    expect(tool.lastSeenAt).toBeNull();
    const authed = fx.tools.authenticate(token);
    expect(authed).not.toBeNull();
    expect(authed!.name).toBe('t');
    expect(authed!.lastSeenAt).not.toBeNull();
  });

  it('rejects an unknown token', () => {
    fx.tools.create({ name: 't', scopes: ['a'] });
    expect(fx.tools.authenticate('dcx_bogustokenthatdoesnotexist')).toBeNull();
  });

  it('rejects duplicate tool names', () => {
    fx.tools.create({ name: 'dup', scopes: ['a'] });
    expect(() => fx.tools.create({ name: 'dup', scopes: ['a'] })).toThrow(/already exists/);
  });

  it('revokes and rotates tokens', () => {
    const { token: original } = fx.tools.create({ name: 't', scopes: ['a'] });
    const rotated = fx.tools.rotateToken('t');
    expect(rotated).not.toBe(original);
    expect(fx.tools.authenticate(original)).toBeNull();
    expect(fx.tools.authenticate(rotated)).not.toBeNull();

    expect(fx.tools.revoke('t')).toBe(true);
    expect(fx.tools.authenticate(rotated)).toBeNull();
  });

  it('requires at least one scope', () => {
    expect(() => fx.tools.create({ name: 't', scopes: [] })).toThrow(/at least one scope/);
  });
});
