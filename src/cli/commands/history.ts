import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';

export function registerHistoryCommands(program: Command): void {
  const hist = program
    .command('history')
    .description('Inspect and search imported conversation history');

  hist
    .command('list')
    .description('List imported conversations')
    .option('--source <source>', 'filter by source (chatgpt, claude, gemini, generic)')
    .option('--scope <scope>', 'filter by scope')
    .option('--limit <n>', 'max results', (v) => Number(v), 100)
    .option('--db <path>', 'override database path')
    .action(async (opts: CommonCliOptions & { source?: string; scope?: string; limit: number }) => {
      await withAppContext(opts, (ctx) => {
        const list = ctx.conversations.list({
          limit: opts.limit,
          ...(opts.source ? { source: opts.source } : {}),
          ...(opts.scope ? { scope: opts.scope } : {}),
        });
        if (list.length === 0) return console.log('(no conversations)');
        for (const c of list) {
          const when = new Date(c.startedAt).toISOString();
          console.log(`#${c.id} [${c.source}/${c.scope ?? '-'}] ${when} — ${c.title}`);
        }
      });
    });

  hist
    .command('search <query...>')
    .description('Semantic search across past conversation messages')
    .option('--source <source>', 'filter by source')
    .option('--scope <scope>', 'filter by scope')
    .option('--limit <n>', 'max messages', (v) => Number(v), 10)
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(
      async (
        queryParts: string[],
        opts: CommonCliOptions & { source?: string; scope?: string; limit: number }
      ) => {
        const query = queryParts.join(' ').trim();
        if (!query) throw new Error('history search: query is empty');
        await withAppContext(opts, async (ctx) => {
          const hits = await ctx.conversations.search(query, {
            limit: opts.limit,
            ...(opts.source ? { source: opts.source } : {}),
            ...(opts.scope ? { scope: opts.scope } : {}),
          });
          if (hits.length === 0) return console.log('(no matches)');
          for (const h of hits) {
            const when = new Date(h.ts).toISOString();
            console.log(
              `[${h.match} ${h.score.toFixed(3)}] ${h.source}/${h.title} [${h.scope ?? '-'}] ${when} <${h.role}>`
            );
            console.log(h.content);
            console.log('');
          }
        });
      }
    );

  hist
    .command('show <id>')
    .description('Print all messages in a conversation, in order')
    .option('--db <path>', 'override database path')
    .action(async (id: string, opts: CommonCliOptions) => {
      await withAppContext(opts, (ctx) => {
        const info = ctx.conversations.getById(Number(id));
        const msgs = ctx.conversations.messages(info.id);
        console.log(`# ${info.title}`);
        console.log(
          `source: ${info.source}   scope: ${info.scope ?? '-'}   started: ${new Date(info.startedAt).toISOString()}`
        );
        console.log('');
        for (const m of msgs) {
          console.log(`<${m.role}> [${new Date(m.ts).toISOString()}]`);
          console.log(m.content);
          console.log('');
        }
      });
    });

  hist
    .command('remove <id>')
    .description('Delete a conversation and its messages')
    .option('--db <path>', 'override database path')
    .action(async (id: string, opts: CommonCliOptions) => {
      await withAppContext(opts, (ctx) => {
        const ok = ctx.conversations.delete(Number(id));
        console.log(ok ? `removed conversation #${id}` : `no conversation with id ${id}`);
      });
    });
}
