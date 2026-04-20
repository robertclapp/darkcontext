# Contributing to DarkContext

Thanks for your interest. DarkContext is small and opinionated; keeping it
that way matters more than landing every feature. This guide is the minimum
a contributor needs to know.

## Ground rules

- **The scope filter is a security boundary.** Every MCP code path routes
  through `src/mcp/scopeFilter.ts`. Do not bypass it. Do not call raw
  domain modules from the MCP layer. See
  [`docs/SECURITY.md`](docs/SECURITY.md) for the full model.
- **Additive schema changes only.** The schema file is the single source of
  truth and is applied with `CREATE TABLE IF NOT EXISTS`. If you need a
  breaking migration, open an issue first.
- **Tests are required.** `scopeFilter.test.ts` is the security spec; any
  change to access control needs new cases there. Domain changes need
  unit coverage. New MCP tools need handler coverage and a registry entry.
- **No new dependencies without discussion.** Runtime dependencies are
  intentionally minimal.

## Getting set up

```bash
git clone https://github.com/robertclapp/darkcontext.git
cd darkcontext
npm install
npm run build
```

Node 20+ is required. No native toolchain is needed beyond what
`better-sqlite3` installs on first `npm install`.

## Dev loop

```bash
npm run typecheck   # src + tests + evals
npm run lint
npm test            # unit + integration
npm run eval        # retrieval + scope-isolation evals
npm run build
```

CI runs `typecheck`, `lint`, `test`, and `build` on every push. Please run
them locally first.

### Adding an MCP tool

1. Create `src/mcp/tools/<name>.ts` exporting a `defineTool({...})`
   declaration. Zod validates input at the SDK boundary.
2. Append it to `ALL_MCP_TOOLS` in `src/mcp/tools/registry.ts`.
3. Add direct handler coverage under `tests/unit/` and, if the name set
   changed, update `tests/unit/tools-registry.test.ts`.

### Adding an importer

Implement the `Importer` interface (pure, `parse(raw)` →
`ImportedConversation[]`), register in `src/core/importers/index.ts`, add a
fixture under `tests/fixtures/`, and wire a CLI subcommand.

### Adding a content domain

Follow `memories/`: schema rows, a `core/<domain>` module with CRUD +
search + `VectorIndex`, new `ScopeFilter` methods (with tests), a new
`defineTool` file, registry entry, CLI command.

## Commit & PR conventions

- Commits: imperative mood, ~72-char subject. Describe the "why" in the
  body if the diff isn't self-explanatory.
- PRs: link any related issue, summarize the change, list what you tested,
  and call out follow-up work you're deferring.
- Draft PRs are welcome for early feedback.

## Reporting bugs / proposing features

Use the issue templates. For security-sensitive reports, see
[`SECURITY.md`](SECURITY.md) — do not open a public issue with a working
exfiltration path.

## Code of conduct

Participation in this project is governed by
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
