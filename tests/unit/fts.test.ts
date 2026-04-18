import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { buildFtsQuery, isFtsAvailable } from '../../src/core/store/fts.js';
import { makeFixture, type Fixture } from '../helpers/factory.js';

describe('buildFtsQuery', () => {
  it('wraps each term as a phrase literal and joins with spaces (FTS5 implicit AND)', () => {
    expect(buildFtsQuery('espresso descaling')).toBe('"espresso" "descaling"');
  });

  it('strips FTS5 syntax characters so user input cannot inject column filters', () => {
    expect(buildFtsQuery('foo*:bar^()')).toBe('"foo" "bar"');
  });

  it('strips the FTS5 reserved operator keywords', () => {
    expect(buildFtsQuery('foo AND bar OR baz NOT qux NEAR zap')).toBe('"foo" "bar" "baz" "qux" "zap"');
  });

  it('returns empty string for entirely-empty-or-punctuation input (callers skip FTS)', () => {
    expect(buildFtsQuery('')).toBe('');
    expect(buildFtsQuery('   ')).toBe('');
    expect(buildFtsQuery('()()::*^')).toBe('');
  });
});

describe('keyword recall uses FTS5 when available', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => fx.cleanup());

  it('FTS5 support is available in the bundled better-sqlite3 build', () => {
    expect(isFtsAvailable(fx.db.raw)).toBe(true);
  });

  it('a FTS5 query surfaces a memory whose words are in a different order than the query', async () => {
    await fx.memories.remember({ content: 'Descale the espresso boiler every 60 shots' });
    await fx.memories.remember({ content: 'Eastern forehand grip for topspin' });

    // Vector path is always on (stub provider), so this tests the combined stack
    // end-to-end. We deliberately query terms in a different order and expect
    // the coffee memory back.
    const hits = await fx.memories.recall('shots every espresso', { limit: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.memory.content).toMatch(/Descale the espresso boiler/);
  });

  it('FTS5 triggers stay in sync on DELETE (deleted rows do not surface)', async () => {
    const a = await fx.memories.remember({ content: 'alpha beta gamma delta' });
    await fx.memories.remember({ content: 'unrelated sentence here' });
    fx.memories.forget(a.id);

    // Query that only matches the deleted row.
    const hits = await fx.memories.recall('beta', { limit: 5 });
    expect(hits.some((h) => h.memory.id === a.id)).toBe(false);
  });
});
