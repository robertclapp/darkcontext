#!/usr/bin/env node
import { Command } from 'commander';

import { registerInit } from './commands/init.js';
import { registerRemember } from './commands/remember.js';
import { registerRecall } from './commands/recall.js';
import { registerForget } from './commands/forget.js';
import { registerList } from './commands/list.js';
import { registerDoctor } from './commands/doctor.js';

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

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
