import { createHash, randomBytes } from 'node:crypto';

/**
 * Token format: `dcx_<base64url>` where the suffix is 32 random bytes
 * encoded unpadded (43 characters). We store only the sha256 hash in
 * the DB — authentication comparison is constant-time.
 */

const PREFIX = 'dcx_';
// 32 random bytes → 43 chars of unpadded base64url.
const TOKEN_BODY_LENGTH = 43;
const TOKEN_BODY_RE = new RegExp(`^[A-Za-z0-9_-]{${TOKEN_BODY_LENGTH}}$`);

export function generateToken(): string {
  const raw = randomBytes(32).toString('base64url');
  return `${PREFIX}${raw}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Strict shape check — matches the exact output of `generateToken`:
 * `dcx_` followed by exactly 43 base64url characters. Rejects anything
 * shorter, longer, or containing non-base64url bytes. Useful for
 * lint / config-sanity checks; actual auth must still go through
 * `Tools.authenticate` which hashes + compares against the store.
 */
export function looksLikeToken(value: string): boolean {
  if (!value.startsWith(PREFIX)) return false;
  return TOKEN_BODY_RE.test(value.slice(PREFIX.length));
}
