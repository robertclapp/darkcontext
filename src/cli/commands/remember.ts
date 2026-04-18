import type { Command } from 'commander';

import { buildContext } from '../context.js';

export function registerRemember(program: Command): void {
  program
    .command('remember <content...>')
    .description('Store a memory')
    .option('--kind <kind>', 'memory kind (fact, preference, event, ...)', 'fact')
    .option('--scope <scope>', 'scope name (created on demand)')
    .option('--tags <tags>', 'comma-separated tags')
    .option('--source <source>', 'optional source label')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(
      async (
        contentParts: string[],
        opts: {
          kind: string;
          scope?: string;
          tags?: string;
          source?: string;
          db?: string;
          provider?: string;
        }
      ) => {
        const content = contentParts.join(' ').trim();
        if (!content) throw new Error('remember: content is empty');
        const ctx = buildContext(opts);
        try {
          const memory = await ctx.memories.remember({
            content,
            kind: opts.kind,
            ...(opts.scope ? { scope: opts.scope } : {}),
            tags: parseTags(opts.tags),
            ...(opts.source ? { source: opts.source } : {}),
          });
          console.log(`#${memory.id} [${memory.scope ?? '-'}] ${memory.content}`);
          if (memory.tags.length) console.log(`  tags: ${memory.tags.join(', ')}`);
        } finally {
          ctx.close();
        }
      }
    );
}

function parseTags(raw?: string): string[] {
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}
