import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';
import { NotFoundError } from '../../core/errors.js';

interface AddItemOptions extends CommonCliOptions {
  kind: string;
  content: string;
  state?: string;
}

export function registerWorkspaceCommands(program: Command): void {
  const ws = program.command('workspace').description('Manage workspaces (project state containers)');

  ws
    .command('add <name>')
    .description('Create a new workspace')
    .option('--scope <scope>', 'scope to attach (created on demand)')
    .option('--db <path>', 'override database path')
    .action(async (name: string, opts: CommonCliOptions & { scope?: string }) => {
      await withAppContext(opts, (ctx) => {
        const w = ctx.workspaces.create({ name, ...(opts.scope ? { scope: opts.scope } : {}) });
        console.log(`#${w.id} ${w.name} [${w.scope ?? '-'}]`);
      });
    });

  ws
    .command('list')
    .description('List workspaces')
    .option('--scope <scope>', 'restrict to a scope')
    .option('--db <path>', 'override database path')
    .action(async (opts: CommonCliOptions & { scope?: string }) => {
      await withAppContext(opts, (ctx) => {
        const list = ctx.workspaces.list(opts.scope ? { scope: opts.scope } : {});
        if (list.length === 0) return console.log('(no workspaces)');
        for (const w of list) {
          console.log(`${w.isActive ? '* ' : '  '}#${w.id} ${w.name} [${w.scope ?? '-'}]`);
        }
      });
    });

  ws
    .command('use <name>')
    .description('Mark a workspace as active')
    .option('--db <path>', 'override database path')
    .action(async (name: string, opts: CommonCliOptions) => {
      await withAppContext(opts, (ctx) => {
        const w = ctx.workspaces.setActive(name);
        console.log(`active: ${w.name}`);
      });
    });

  ws
    .command('add-item <name>')
    .description('Add an item to a workspace')
    .requiredOption('--kind <kind>', 'item kind (task, goal, note, thread, ...)')
    .requiredOption('--content <content>', 'item body')
    .option('--state <state>', "lifecycle state (default 'open')")
    .option('--db <path>', 'override database path')
    .action(async (name: string, opts: AddItemOptions) => {
      await withAppContext(opts, (ctx) => {
        const target = ctx.workspaces.getByName(name);
        if (!target) throw new NotFoundError('workspace', name);
        const item = ctx.workspaces.addItem(target.id, {
          kind: opts.kind,
          content: opts.content,
          ...(opts.state ? { state: opts.state } : {}),
        });
        console.log(`#${item.id} [${item.kind}/${item.state}] ${item.content}`);
      });
    });

  ws
    .command('items <name>')
    .description('List items in a workspace')
    .option('--state <state>', 'filter by lifecycle state')
    .option('--db <path>', 'override database path')
    .action(async (name: string, opts: CommonCliOptions & { state?: string }) => {
      await withAppContext(opts, (ctx) => {
        const target = ctx.workspaces.getByName(name);
        if (!target) throw new NotFoundError('workspace', name);
        const items = ctx.workspaces.listItems(target.id, opts.state ? { state: opts.state } : {});
        if (items.length === 0) return console.log('(no items)');
        for (const i of items) console.log(`#${i.id} [${i.kind}/${i.state}] ${i.content}`);
      });
    });
}
