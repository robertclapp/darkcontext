# Shared context across agents

The hard part of shared memory isn't storing it — it's (a) wiring every
agent to the same store without hand-editing config each time, and (b)
getting the threads you've already had with Claude Code / Codex / Cursor
into one searchable place. DarkContext does both.

## Connect an agent in one step

`dcx connect <client>` provisions a bearer token and prints the exact,
paste-ready config for that client. By default it grants the **`shared`**
scope, so every agent you connect reads and writes the *same* context —
that's the "shared across agents without wiring it manually" part. Pass
`--scopes` to draw a tighter boundary (per-repo, per-tool, per-task).

```bash
dcx connect claude-code      # prints `claude mcp add-json …` + .mcp.json block
dcx connect cursor           # prints the .cursor/mcp.json block
dcx connect codex            # prints the ~/.codex/config.toml block
dcx connect claude-desktop   # prints the claude_desktop_config.json block

# Tighter boundary: a scope just for one repo
dcx connect cursor --name cursor-acme --scopes acme
```

Each connected agent now shares context: a fact one agent `remember`s is
recalled by the next, and `recall` / `search_history` span everything.

## Index threads across tools

`dcx import auto` discovers local agent-CLI sessions and ingests them, so
"ctrl+F across threads to pick it back up" becomes one search. It's
idempotent — safe to run on a cron/timer; already-imported sessions are
skipped.

```bash
dcx import auto                       # scans ~/.claude/projects + ~/.codex/sessions
dcx import auto --scope work          # file them under a scope
dcx history search "that race condition we debugged last week"
```

Default discovery roots:

| Tool        | Default location              | Override |
|-------------|-------------------------------|----------|
| Claude Code | `~/.claude/projects/**/*.jsonl` | `--claude-code-root` |
| Codex CLI   | `~/.codex/sessions/**/*.jsonl`  | `--codex-root` |

Single files work too:

```bash
dcx import claude-code ~/.claude/projects/my-repo/<session>.jsonl
dcx import codex ~/.codex/sessions/2024/06/01/rollout-*.jsonl
```

### Cursor

Cursor stores chat in a SQLite state DB rather than JSONL, so there's no
auto-discovery importer yet. Export a thread to JSON and use the generic
importer in the meantime:

```bash
dcx import generic cursor-thread.json --scope work
```

## Keeping it from bloating (the "wiki model" concern)

Imported history grows fast. Two built-ins keep recall sharp:

- **`dcx summarize "<topic>" --scope <s> --save`** — condense many threads
  into one durable memory (the "stop the agent thinking about it twice"
  win), instead of re-reading raw transcripts every time.
- **`dcx scope set-retention <scope> <days>` + `dcx prune`** — age out
  stale scratch threads on a schedule so the signal-to-noise stays high.

## How the boundary is drawn

Scope is the enforcement point. A connected agent only sees scopes its
token was granted, and `recall`/`search_documents`/`search_history`
over-fetch then filter by scope so a minority scope's own matches aren't
crowded out by a noisier neighbor (see `docs/SECURITY.md` and the
scope-isolation eval). Draw the boundary however fits your workflow:

- **by tool** — `dcx connect cursor --scopes cursor` (each agent siloed)
- **shared** — the default; everything in one `shared` scope
- **by repo/task** — `--scopes acme,billing` (grant a tool several)
