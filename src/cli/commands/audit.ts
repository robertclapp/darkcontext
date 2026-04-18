import type { Command } from 'commander';

import type { CommonCliOptions } from '../context.js';
import { parsePositiveInt, withAppContext } from '../context.js';
import { AuditLog } from '../../core/audit/index.js';
import { ValidationError } from '../../core/errors.js';

const AUDIT_OUTCOMES = ['ok', 'denied', 'error'] as const;
type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** Parse + validate `--outcome` at option-parse time. Rejecting invalid
 *  values early (as a ValidationError → exit 64) is friendlier than
 *  silently returning an empty result set. */
function parseOutcome(value: string): AuditOutcome {
  if ((AUDIT_OUTCOMES as readonly string[]).includes(value)) return value as AuditOutcome;
  throw new ValidationError(
    'outcome',
    `must be one of: ${AUDIT_OUTCOMES.join(', ')} (got: ${value})`
  );
}

export function registerAuditCommands(program: Command): void {
  const audit = program.command('audit').description('Inspect the MCP audit log');

  audit
    .command('list')
    .description('List recent audit entries (newest first)')
    .option('--limit <n>', 'max rows', parsePositiveInt('limit'), 50)
    .option('--tool <name>', 'filter by calling tool name')
    .option('--outcome <o>', `filter by outcome (${AUDIT_OUTCOMES.join(' | ')})`, parseOutcome)
    .option('--db <path>', 'override database path')
    .action(
      async (opts: CommonCliOptions & { limit: number; tool?: string; outcome?: string }) => {
        await withAppContext(opts, (ctx) => {
          const rows = new AuditLog(ctx.db, null).list({
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
        });
      }
    );

  audit
    .command('prune')
    .description('Delete audit rows older than the given ISO timestamp')
    .requiredOption('--before <iso>', 'ISO timestamp (exclusive)')
    .option('--db <path>', 'override database path')
    .action(async (opts: CommonCliOptions & { before: string }) => {
      const before = Date.parse(opts.before);
      if (Number.isNaN(before)) throw new ValidationError('before', `unparseable timestamp: ${opts.before}`);
      await withAppContext(opts, (ctx) => {
        const n = new AuditLog(ctx.db, null).prune(before);
        console.log(`pruned ${n} audit rows older than ${opts.before}`);
      });
    });
}
