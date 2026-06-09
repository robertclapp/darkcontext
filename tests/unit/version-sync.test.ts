import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VERSION } from '../../src/core/constants.js';

/**
 * `VERSION` (src/core/constants.ts) is the single source of truth for the
 * CLI banner, `/healthz`, and any future user-visible version string.
 * package.json is the source of truth for npm + downstream tooling.
 *
 * They have to match. Previously the CLI's `.version(...)` call and the
 * package.json version drifted to different strings (0.1.0 vs 0.2.0),
 * and the mismatch only surfaced when a reviewer ran `dcx --version`.
 * This test catches future drift on every CI run.
 */

describe('version sync', () => {
  it('VERSION constant matches package.json version', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });
});
