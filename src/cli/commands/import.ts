import type { Command } from 'commander';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { CommonCliOptions } from '../context.js';
import { withAppContext } from '../context.js';
import type { AppContext } from '../../core/context.js';
import {
  resolveImporter,
  type ImportedConversation,
  type ImporterKind,
} from '../../core/importers/index.js';

const SUBCOMMANDS: Array<{ kind: ImporterKind; alias?: string }> = [
  { kind: 'chatgpt' },
  { kind: 'claude' },
  { kind: 'claude-code' },
  { kind: 'codex' },
  { kind: 'gemini' },
  { kind: 'generic', alias: 'json' },
];

/**
 * Parse a file and stamp a stable `externalId` on any conversation that
 * lacks one, so re-importing the same file is idempotent (conversations
 * dedupe on UNIQUE(source, external_id)). Importers that already extract a
 * session id keep it; formats without one fall back to `<path>#<index>`.
 *
 * The index suffix matters: the Gemini Takeout importer and the documented
 * generic array shape can return MULTIPLE conversations per file without
 * externalIds. Using the bare path as fallback would collapse all of them
 * to the same `(source, external_id)` key — only the first conversation
 * would be inserted and the rest counted as skipped. The index is stable
 * across re-imports because the importers parse in deterministic order.
 */
function parseFile(kind: ImporterKind, path: string): ImportedConversation[] {
  const raw = readFileSync(path, 'utf8');
  const convs = resolveImporter(kind).parse(raw);
  return convs.map((c, i) => (c.externalId ? c : { ...c, externalId: `${path}#${i}` }));
}

export interface ImportAutoOptions extends CommonCliOptions {
  scope?: string;
  claudeCodeRoot?: string;
  codexRoot?: string;
}

export function registerImport(program: Command): void {
  const imp = program
    .command('import')
    .description('Import conversation history from a supported exporter or agent CLI');

  for (const { kind, alias } of SUBCOMMANDS) {
    const cmd = imp.command(`${kind} <path>`).description(describe(kind));
    if (alias) cmd.aliases([alias]);
    cmd
      .option('--scope <scope>', 'scope to ingest into (created on demand)')
      .option('--db <path>', 'override database path')
      .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
      .action(async (path: string, opts: CommonCliOptions & { scope?: string }) => {
        const parsed = parseFile(kind, resolve(path));
        if (parsed.length === 0) {
          console.log('(no conversations parsed)');
          return;
        }
        await withAppContext(opts, async (ctx) => {
          const res = await ctx.conversations.ingest(kind, parsed, {
            ...(opts.scope ? { scope: opts.scope } : {}),
          });
          console.log(
            `imported: ${res.inserted} conversations, ${res.messages} messages (${res.skipped} skipped — already present)`
          );
        });
      });
  }

  imp
    .command('auto')
    .description(
      'Discover and import local agent-CLI sessions (Claude Code + Codex) so threads across tools are searchable without manual wiring'
    )
    .option('--scope <scope>', 'scope to ingest into (created on demand)')
    .option('--claude-code-root <dir>', 'override the Claude Code projects dir (default ~/.claude/projects)')
    .option('--codex-root <dir>', 'override the Codex sessions dir (default ~/.codex/sessions)')
    .option('--db <path>', 'override database path')
    .option('--provider <name>', 'embeddings provider: stub | ollama | onnx')
    .action(async (opts: ImportAutoOptions) => {
      await runImportAuto(opts);
    });
}

interface SourceSpec {
  kind: ImporterKind;
  root: string;
}

/**
 * Scan the well-known on-disk locations of agent CLIs and ingest every
 * session found. Idempotent: sessions already imported (matched by
 * source + session id / file path) are skipped, so it's safe to run on a
 * schedule. Prints a per-source summary.
 */
export async function runImportAuto(
  opts: ImportAutoOptions,
  out: (line: string) => void = console.log
): Promise<void> {
  const home = homedir();
  const sources: SourceSpec[] = [
    { kind: 'claude-code', root: resolve(opts.claudeCodeRoot ?? join(home, '.claude', 'projects')) },
    { kind: 'codex', root: resolve(opts.codexRoot ?? join(home, '.codex', 'sessions')) },
  ];

  await withAppContext(opts, async (ctx) => {
    let anyFound = false;
    for (const { kind, root } of sources) {
      const files = findJsonlFiles(root);
      if (files.length === 0) {
        out(`${kind}: no sessions found under ${root}`);
        continue;
      }
      anyFound = true;
      const totals = await ingestFiles(ctx, kind, files, opts.scope);
      out(
        `${kind}: ${files.length} files → ${totals.inserted} new conversations, ` +
          `${totals.messages} messages (${totals.skipped} already present)`
      );
    }
    if (!anyFound) {
      out('Nothing to import. Point --claude-code-root / --codex-root at your session dirs, or use `dcx import <tool> <path>`.');
    }
  });
}

async function ingestFiles(
  ctx: AppContext,
  kind: ImporterKind,
  files: string[],
  scope: string | undefined
): Promise<{ inserted: number; messages: number; skipped: number }> {
  const totals = { inserted: 0, messages: 0, skipped: 0 };
  for (const file of files) {
    let parsed: ImportedConversation[];
    try {
      parsed = parseFile(kind, file);
    } catch {
      // One unreadable session shouldn't abort the whole sweep.
      continue;
    }
    if (parsed.length === 0) continue;
    const res = await ctx.conversations.ingest(kind, parsed, {
      ...(scope ? { scope } : {}),
    });
    totals.inserted += res.inserted;
    totals.messages += res.messages;
    totals.skipped += res.skipped;
  }
  return totals;
}

/** Recursively collect `*.jsonl` files under `root`; [] if root is absent. */
function findJsonlFiles(root: string): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { recursive: true }) as string[]) {
    if (entry.endsWith('.jsonl')) {
      const full = join(root, entry);
      try {
        if (statSync(full).isFile()) out.push(full);
      } catch {
        /* race: file vanished between readdir and stat — skip */
      }
    }
  }
  return out.sort();
}

function describe(kind: ImporterKind): string {
  switch (kind) {
    case 'chatgpt':     return 'Import ChatGPT `conversations.json` from a ChatGPT data export';
    case 'claude':      return 'Import Claude data export (JSON array of conversations with chat_messages)';
    case 'claude-code': return 'Import a Claude Code session transcript (.jsonl from ~/.claude/projects)';
    case 'codex':       return 'Import a Codex CLI session rollout (.jsonl from ~/.codex/sessions)';
    case 'gemini':      return 'Import Gemini activity from Google Takeout (MyActivity.json)';
    case 'generic':     return 'Import the generic DarkContext JSON shape (see docs). Alias: `json`.';
  }
}
