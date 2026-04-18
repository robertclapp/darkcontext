#!/usr/bin/env node
import { Command } from 'commander';

import { exitCodeFor, formatError } from './exit-codes.js';

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
