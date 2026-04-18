import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultStoreDir(): string {
  return process.env.DARKCONTEXT_HOME ?? join(homedir(), '.darkcontext');
}

export function defaultDbPath(): string {
  return join(defaultStoreDir(), 'store.db');
}
