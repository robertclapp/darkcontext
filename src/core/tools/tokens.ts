import { createHash, randomBytes } from 'node:crypto';

/**
 * Token format: `dcx_<base64url>` where the suffix is 32 random bytes.
 * We store only the sha256 hash in the DB — comparison is constant-time.
 */

const PREFIX = 'dcx_';

export function generateToken(): string {
  const raw = randomBytes(32).toString('base64url');
  return `${PREFIX}${raw}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function looksLikeToken(value: string): boolean {
  return value.startsWith(PREFIX) && value.length > PREFIX.length + 16;
}
