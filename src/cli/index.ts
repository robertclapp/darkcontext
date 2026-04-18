#!/usr/bin/env node
import { Command } from 'commander';

import {
  AuthError,
  ConfigError,
  DarkContextError,
  NotFoundError,
  ValidationError,
} from '../core/errors.js';

import { registerInit } from './commands/init.js';
import { registerRemember } from './commands/remember.js';
import { registerRecall } from './commands/recall.js';
import { registerForget } from './commands/forget.js';
import { registerList } from './commands/list.js';
import { registerDoctor } from './commands/doctor.js';
import { registerToolCommands } from './commands/tool.js';
import { registerScopeCommands } from './commands/scope.js';
import { registerServe } from './commands/serve.js';
import { registerIngest } from './commands/ingest.js';
import { registerDocumentCommands } from './commands/document.js';
import { registerWorkspaceCommands } from './commands/workspace.js';
import { registerImport } from './commands/import.js';
import { registerHistoryCommands } from './commands/history.js';
import { registerBackup } from './commands/backup.js';
import { registerAuditCommands } from './commands/audit.js';
import { registerReindex } from './commands/reindex.js';

const program = new Command();
program
  .name('dcx')
  .description('DarkContext — bring-your-own-context layer for LLMs')
  .version('0.1.0');

registerInit(program);
registerRemember(program);
registerRecall(program);
registerForget(program);
registerList(program);
registerDoctor(program);
registerToolCommands(program);
registerScopeCommands(program);
registerIngest(program);
registerDocumentCommands(program);
registerWorkspaceCommands(program);
registerImport(program);
registerHistoryCommands(program);
registerBackup(program);
registerAuditCommands(program);
registerReindex(program);
registerServe(program);

program.parseAsync(process.argv).catch((err) => {
  console.error(formatError(err));
  process.exit(exitCodeFor(err));
});

/**
 * Format an error for stderr. For typed DarkContextErrors we prefix with
 * the class name so integrators scripting against `dcx` can distinguish
 * "this tool doesn't exist" from "you passed bad arguments" without
 * parsing free-form messages.
 */
function formatError(err: unknown): string {
  if (err instanceof DarkContextError) return `${err.name}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Sysexits-style exit codes. Scripts can branch on these without parsing
 * stderr:
 *   64 EX_USAGE      — user error: bad arguments, malformed input
 *   66 EX_NOINPUT    — requested entity doesn't exist
 *   77 EX_NOPERM     — auth or scope denial
 *   78 EX_CONFIG     — env / store / schema is wrong for this binary
 *    1 generic domain error
 *    2 unexpected (likely a bug)
 */
function exitCodeFor(err: unknown): number {
  if (err instanceof ValidationError) return 64;
  if (err instanceof NotFoundError) return 66;
  if (err instanceof AuthError) return 77;
  if (err instanceof ConfigError) return 78;
  if (err instanceof DarkContextError) return 1;
  return 2;
}
