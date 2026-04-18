# DarkContext evals

Evaluations — reproducible measurements of DarkContext behavior on
labeled inputs. Distinct from the unit test suite: evals may be slow,
may depend on optional providers (Ollama / ONNX), and may report
quantitative numbers rather than pass/fail booleans.

## What's here

| Eval | What it measures | How to run |
|---|---|---|
| `retrieval` | recall@1 / recall@5 of the full search stack (vector when available, FTS5 fallback) against a labeled query set | `npm run eval:retrieval` |
| `scope-isolation` | Whether a malicious MCP tool with disjoint scopes can discover, enumerate, or delete data it wasn't granted access to | `npm run eval:security` |

All evals: `npm run eval`.

## Writing a new eval

Each eval is a TypeScript file under `evals/<name>/run.ts` that:

1. Sets up an `AppContext` (usually a tmp-dir one, via the test fixture
   helper — import from `tests/helpers/factory.ts`).
2. Runs the scenario.
3. Prints a structured report to stdout (ISO timestamp + `name: value`
   lines so CI can pipe to grafana or similar).
4. Exits with code `1` if the eval fails its asserted threshold.

The goal is that CI can run `npm run eval` and get a one-screen
verdict; a human reviewer can read the same output and understand what
each number means. Keep the structure flat and the metrics named.

## When to add an eval vs a unit test

Use a **unit test** when you're asserting a single known-correct
answer for a specific code path.

Use an **eval** when:

- You're measuring behavior on a distribution of inputs (e.g. retrieval
  quality) rather than a single case.
- You're checking a policy property (e.g. scope isolation) against
  adversarial input patterns, not just the golden path.
- You're comparing implementations (e.g. stub vs ollama embeddings)
  rather than verifying one.
