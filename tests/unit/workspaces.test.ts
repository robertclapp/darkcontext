import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { makeFixture, type Fixture } from '../helpers/factory.js';

describe('Workspaces', () => {
  let fx: Fixture;
  beforeEach(() => { fx = makeFixture(); });
  afterEach(() => fx.cleanup());

  it('creates and lists workspaces', () => {
    fx.workspaces.create({ name: 'darkcontext', scope: 'work' });
    fx.workspaces.create({ name: 'personal', scope: 'personal' });
    expect(fx.workspaces.list()).toHaveLength(2);
    expect(fx.workspaces.list({ scope: 'work' })).toHaveLength(1);
  });

  it('toggles exactly one active workspace at a time', () => {
    fx.workspaces.create({ name: 'a' });
    fx.workspaces.create({ name: 'b' });
    fx.workspaces.setActive('a');
    expect(fx.workspaces.getActive()?.name).toBe('a');
    fx.workspaces.setActive('b');
    expect(fx.workspaces.getActive()?.name).toBe('b');
    expect(fx.workspaces.list().filter((w) => w.isActive)).toHaveLength(1);
  });

  it('adds and lists workspace items', () => {
    const ws = fx.workspaces.create({ name: 'proj' });
    fx.workspaces.addItem(ws.id, { kind: 'task', content: 'ship M3' });
    fx.workspaces.addItem(ws.id, { kind: 'note', content: 'chunker is paragraph-aware' });
    fx.workspaces.addItem(ws.id, { kind: 'task', content: 'ship M4', state: 'blocked' });

    const all = fx.workspaces.listItems(ws.id);
    expect(all).toHaveLength(3);

    const blocked = fx.workspaces.listItems(ws.id, { state: 'blocked' });
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.content).toBe('ship M4');
  });

  it('rejects empty workspace names', () => {
    expect(() => fx.workspaces.create({ name: ' ' })).toThrow(/name is required/);
  });

  it('setActive throws for unknown workspace', () => {
    expect(() => fx.workspaces.setActive('ghost')).toThrow(/not found/);
  });
});
