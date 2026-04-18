# DarkContext MCP Tools

The server advertises eight tools. Their canonical declarations live in
`src/mcp/tools/*.ts` as `defineTool({...})` exports; the registry in
`src/mcp/tools/registry.ts` (`ALL_MCP_TOOLS`) is the single source of
truth for the public surface. Every invocation routes through
`ScopeFilter` (security) and `withAudit` (audit).

Conventions:

- "readable" = the calling tool has `can_read = 1` on the scope.
- "writable" = the calling tool has `can_write = 1` on the scope.
- Scope denials surface as `isError: true` tool results whose text starts
  with `permission denied: ...`; audit rows carry `outcome: "denied"`.
- `forget` and cross-scope reads deliberately avoid distinguishing "not
  found" from "not yours" — see SECURITY.md for the existence-leak
  reasoning.

---

## `remember`

Store a memory (atomic fact, preference, event).

| Field   | Type       | Notes                                                      |
|---------|------------|------------------------------------------------------------|
| content | string     | Required. The fact body.                                   |
| kind    | string?    | Default `fact`. Free-form category.                        |
| scope   | string?    | Omit = first writable scope. Must be writable if provided. |
| tags    | string[]?  | Optional filtering tags.                                   |
| source  | string?    | Optional source label (e.g. conversation id).              |

Returns `{ id, scope, kind, tags }`.

---

## `recall`

Semantic search across memories, filtered to readable scopes. Uses the
vector index when available and falls back to FTS5 (and finally
`LIKE '%q%'` on SQLite builds without FTS5).

| Field | Type     | Notes                                                  |
|-------|----------|--------------------------------------------------------|
| query | string   | Required.                                              |
| scope | string?  | Must be readable if provided.                          |
| limit | number?  | 1..50, default 10.                                     |

Returns `{ hits: [{ id, content, scope, tags, kind, score, match }] }`.
`match` is `"vector"` when the vector index contributed, `"keyword"`
otherwise.

---

## `forget`

Delete a memory by id.

Input `{ id: number }`. Returns `{ deleted: boolean, id }`.

Cross-scope / nonexistent ids both return `deleted: false` — the server
does not distinguish these cases.

---

## `search_documents`

Semantic search over ingested document chunks.

| Field | Type     | Notes                                   |
|-------|----------|-----------------------------------------|
| query | string   | Required.                               |
| scope | string?  | Must be readable if provided.           |
| limit | number?  | 1..25, default 10.                      |

Returns `{ hits: [{ documentId, title, scope, chunkIdx, content, score, match }] }`.

---

## `search_history`

Semantic search over imported conversation messages.

| Field  | Type     | Notes                                                          |
|--------|----------|----------------------------------------------------------------|
| query  | string   | Required.                                                      |
| scope  | string?  | Must be readable if provided.                                  |
| source | string?  | Filter by importer: `chatgpt`, `claude`, `gemini`, `generic`.  |
| limit  | number?  | 1..50, default 10.                                             |

Returns `{ hits: [{ conversationId, source, title, scope, messageId, role, content, ts, score, match }] }`.

---

## `list_workspaces`

Returns the workspaces the calling tool can read. Input `{}`.

---

## `get_active_workspace`

Returns the active workspace if it's in a readable scope, else `null`
without leaking that an active workspace exists elsewhere.

---

## `add_to_workspace`

Append an item to a workspace. Requires write access on the workspace's
scope.

| Field        | Type     | Notes                                             |
|--------------|----------|---------------------------------------------------|
| kind         | string   | Required. `task`, `goal`, `note`, `thread`, …    |
| content      | string   | Required.                                         |
| workspaceId  | number?  | Target id. Omit = active workspace.               |
| state        | string?  | Lifecycle (default `open`).                       |

---

## Extending the surface

Add a new tool in three steps:

1. Create `src/mcp/tools/<name>.ts` exporting a `defineTool({...})`
   declaration. Zod validates input at the SDK boundary, so give the
   handler typed `args`.
2. Append it to `ALL_MCP_TOOLS` in `src/mcp/tools/registry.ts`.
3. Add a case to `tests/unit/tools-registry.test.ts` if the name set
   changes, plus direct handler coverage.

The registry loop handles audit wrapping uniformly — no per-tool
register function needed.

---

## Configuring a client

### Claude Desktop (stdio)

```json
{
  "mcpServers": {
    "darkcontext": {
      "command": "dcx",
      "args": ["serve"],
      "env": { "DARKCONTEXT_TOKEN": "dcx_..." }
    }
  }
}
```

### HTTP-speaking clients

```
DARKCONTEXT_TOKEN=dcx_... dcx serve --http --port 4000
```

Clients POST JSON-RPC to `http://127.0.0.1:4000/mcp` with
`Authorization: Bearer dcx_...` and
`Accept: application/json, text/event-stream`.
