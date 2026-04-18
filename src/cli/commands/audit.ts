import type { Command } from 'commander';

import { openDb } from '../../core/store/db.js';
import { AuditLog } from '../../core/audit/index.js';

export function registerAuditCommands(program: Command): void {
  const audit = program.command('audit').description('Inspect the MCP audit log');

  audit
    .command('list')
    .description('List recent audit entries (newest first)')
    .option('--limit <n>', 'max rows', (v) => Number(v), 50)
    .option('--tool <name>', 'filter by calling tool name')
    .option('--outcome <o>', 'filter by outcome (ok | denied | error)')
    .option('--db <path>', 'override database path')
    .action(
      (opts: { limit: number; tool?: string; outcome?: string; db?: string }) => {
        const db = openDb(opts.db ? { path: opts.db } : {});
        try {
          const rows = new AuditLog(db, null).list({
            limit: opts.limit,
            ...(opts.tool ? { toolName: opts.tool } : {}),
            ...(opts.outcome ? { outcome: opts.outcome } : {}),
          });
          if (rows.length === 0) return console.log('(empty)');
          for (const r of rows) {
            const when = new Date(r.ts).toISOString();
            const args = JSON.stringify(r.args);
            const err = r.error ? `  err=${r.error}` : '';
            console.log(
              `${when}  ${r.toolName.padEnd(16)} ${r.mcpTool.padEnd(20)} ${r.outcome.padEnd(6)} ${r.durationMs}ms  args=${args}${err}`
            );
          }
        } finally {
          db.close();
        }
      }
    );

  audit
    .command('prune')
    .description('Delete audit rows older than the given ISO timestamp')
    .requiredOption('--before <iso>', 'ISO timestamp (exclusive)')
    .option('--db <path>', 'override database path')
    .action((opts: { before: string; db?: string }) => {
      const before = Date.parse(opts.before);
      if (Number.isNaN(before)) throw new Error(`unparseable timestamp: ${opts.before}`);
      const db = openDb(opts.db ? { path: opts.db } : {});
      try {
        const n = new AuditLog(db, null).prune(before);
        console.log(`pruned ${n} audit rows older than ${opts.before}`);
      } finally {
        db.close();
      }
    });
}
