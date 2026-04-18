/**
 * Tiny helpers shared by the eval scripts.
 *
 * Evals run outside vitest so they can emit their own machine-readable
 * output and be composed into a single `npm run eval` entry point. This
 * file deliberately has zero runtime dependencies beyond what evals
 * already need (the core modules + node builtins).
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AppContext } from '../src/core/context.js';
import type { ProviderKind } from '../src/core/embeddings/index.js';

export interface EvalCase {
  /** A short name operators will see in the log / report. */
  name: string;
  /** Pass/fail assertion; implement with plain `if (...) fail(...)`. */
  run(report: Reporter): Promise<void> | void;
}

export interface Reporter {
  /** Structured metric line: `<name>: <value>`. */
  metric(name: string, value: number | string): void;
  /** Asserted bound; records pass/fail AND the observed value. */
  assert(name: string, observed: number, cmp: '>=' | '<=' | '==' | '>' | '<', threshold: number): void;
  /** Free-form note for operators. */
  note(message: string): void;
  /** Incremented by `assert` when the observed value is out of bound. */
  readonly failures: number;
  readonly metrics: Record<string, number | string>;
}

export function makeReporter(): Reporter {
  const metrics: Record<string, number | string> = {};
  const state = { failures: 0 };
  return {
    metric(name, value) {
      metrics[name] = value;
      process.stdout.write(`  ${name}: ${value}\n`);
    },
    assert(name, observed, cmp, threshold) {
      metrics[name] = observed;
      const ok = compare(observed, cmp, threshold);
      const verdict = ok ? 'PASS' : 'FAIL';
      process.stdout.write(`  [${verdict}] ${name} = ${observed} ${cmp} ${threshold}\n`);
      if (!ok) state.failures++;
    },
    note(msg) {
      process.stdout.write(`  # ${msg}\n`);
    },
    get failures() { return state.failures; },
    get metrics() { return metrics; },
  };
}

function compare(a: number, cmp: string, b: number): boolean {
  switch (cmp) {
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '>':  return a > b;
    case '<':  return a < b;
    case '==': return a === b;
    default:   return false;
  }
}

/**
 * Open a disposable `AppContext` pointed at a temp directory + stub
 * embeddings by default. Callers can override `providerKind` to measure
 * real providers (Ollama / ONNX) when those are installed.
 */
export function openEvalContext(opts: { providerKind?: ProviderKind } = {}): {
  ctx: AppContext;
  close: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'dcx-eval-'));
  const ctx = AppContext.open({
    dbPath: join(dir, 'store.db'),
    embeddings: opts.providerKind ?? 'stub',
  });
  return {
    ctx,
    close: () => {
      ctx.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Top-level runner used by `evals/run-all.ts`. Each eval prints its own
 * header + metrics; this function tallies failures across the set and
 * exits non-zero when any eval fails, so CI is a one-line `npm run eval`.
 */
export async function runEvals(cases: EvalCase[]): Promise<void> {
  let totalFailures = 0;
  for (const c of cases) {
    process.stdout.write(`\n# ${c.name}\n`);
    const reporter = makeReporter();
    try {
      await c.run(reporter);
    } catch (err) {
      process.stdout.write(`  [FAIL] threw: ${(err as Error).message}\n`);
      totalFailures++;
      continue;
    }
    totalFailures += reporter.failures;
  }
  process.stdout.write(`\n# summary\n  evals: ${cases.length}\n  failures: ${totalFailures}\n`);
  if (totalFailures > 0) process.exit(1);
}
