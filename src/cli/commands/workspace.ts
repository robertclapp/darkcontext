import type { Command } from 'commander';

import { openDb } from '../../core/store/db.js';
import { Workspaces } from '../../core/workspace/index.js';

export function registerWorkspaceCommands(program: Command): void {
  const ws = program.command('workspace').description('Manage workspaces (project state containers)');

  ws
    .command('add <name>')
    .description('Create a new workspace')
    .option('--scope <scope>', 'scope to attach (created on demand)')
    .option('--db <path>', 'override database path')
    .action((name: string, opts: { scope?: string; db?: string }) => {
      const db = openDb(opts.db ? { path: opts.db } : {});
      try {
        const w = new Workspaces(db).create({
          name,
          ...(opts.scope ? { scope: opts.scope } : {}),
        });
        console.log(`#${w.id} ${w.name} [${w.scope ?? '-'}]`);
      } finally {
        db.close();
      }
    });

  ws
    .command('list')
    .description('List workspaces')
    .option('--scope <scope>', 'restrict to a scope')
    .option('--db <path>', 'override database path')
    .action((opts: { scope?: string; db?: string }) => {
      const db = openDb(opts.db ? { path: opts.db } : {});
      try {
        const list = new Workspaces(db).list(opts.scope ? { scope: opts.scope } : {});
        if (list.length === 0) return console.log('(no workspaces)');
        for (const w of list) {
          console.log(`${w.isActive ? '* ' : '  '}#${w.id} ${w.name} [${w.scope ?? '-'}]`);
        }
      } finally {
        db.close();
      }
    });

  ws
    .command('use <name>')
    .description('Mark a workspace as active')
    .option('--db <path>', 'override database path')
    .action((name: string, opts: { db?: string }) => {
      const db = openDb(opts.db ? { path: opts.db } : {});
      try {
        const w = new Workspaces(db).setActive(name);
        console.log(`active: ${w.name}`);
      } finally {
        db.close();
      }
    });

  ws
    .command('add-item <name>')
    .description('Add an item to a workspace')
    .requiredOption('--kind <kind>', "item kind (task, goal, note, thread, ...)")
    .requiredOption('--content <content>', 'item body')
    .option('--state <state>', "lifecycle state (default 'open')")
    .option('--db <path>', 'override database path')
    .action(
      (
        name: string,
        opts: { kind: string; content: string; state?: string; db?: string }
      ) => {
        const db = openDb(opts.db ? { path: opts.db } : {});
        try {
          const ws = new Workspaces(db);
          const target = ws.getByName(name);
          if (!target) throw new Error(`no workspace named '${name}'`);
          const item = ws.addItem(target.id, {
            kind: opts.kind,
            content: opts.content,
            ...(opts.state ? { state: opts.state } : {}),
          });
          console.log(`#${item.id} [${item.kind}/${item.state}] ${item.content}`);
        } finally {
          db.close();
        }
      }
    );

  ws
    .command('items <name>')
    .description('List items in a workspace')
    .option('--state <state>', 'filter by lifecycle state')
    .option('--db <path>', 'override database path')
    .action((name: string, opts: { state?: string; db?: string }) => {
      const db = openDb(opts.db ? { path: opts.db } : {});
      try {
        const ws = new Workspaces(db);
        const target = ws.getByName(name);
        if (!target) throw new Error(`no workspace named '${name}'`);
        const items = ws.listItems(target.id, opts.state ? { state: opts.state } : {});
        if (items.length === 0) return console.log('(no items)');
        for (const i of items) {
          console.log(`#${i.id} [${i.kind}/${i.state}] ${i.content}`);
        }
      } finally {
        db.close();
      }
    });
}
