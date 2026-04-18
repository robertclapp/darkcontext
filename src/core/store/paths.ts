import { homedir } from 'node:os';
import { join } from 'node:path';

/** Storage root. Reads DARKCONTEXT_HOME if set AND non-empty — treating
 *  an empty-string env var as "unset" avoids relative-path stores when
 *  the shell clears the variable with `DARKCONTEXT_HOME= dcx ...`. */
export function defaultStoreDir(): string {
  const env = process.env.DARKCONTEXT_HOME?.trim();
  return env && env.length > 0 ? env : join(homedir(), '.darkcontext');
}

export function defaultDbPath(): string {
  return join(defaultStoreDir(), 'store.db');
}
