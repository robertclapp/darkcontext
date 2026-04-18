# DarkContext MCP Tools

The server advertises 8 tools. All of them pass through `ScopeFilter`
and produce an `audit_log` row per invocation.

Conventions:
- "readable" = the calling tool has `can_read = 1` on the scope.
- "writable" = the calling tool has `can_write = 1` on the scope.
- Errors appear as `isError: true` tool results with a text message
  beginning `permission denied: ...` for scope denials.

---

## `remember`

Store a memory (atomic fact, preference, event).

**Input**
| Field   | Type       | Notes                                                            |
|---------|------------|------------------------------------------------------------------|
| content | string     | Required. The fact body.                                         |
| kind    | string?    | Default `fact`. Free-form category.                              |
| scope   | string?    | Omit = first writable scope. Must be writable if provided.       |
| tags    | string[]?  | Optional filtering tags.                                         |
| source  | string?    | Optional source label (e.g. conversation id).                    |

**Returns** structured `{ id, scope, kind, tags }`.

---

## `recall`

Semantic search across memories, filtered to readable scopes.

**Input**
| Field | Type     | Notes                                                  |
|-------|----------|--------------------------------------------------------|
| query | string   | Required.                                              |
| scope | string?  | Must be readable if provided.                          |
| limit | number?  | 1..50, default 10.                                     |

**Returns** `{ hits: [{ id, content, scope, tags, kind, score, match }] }`.
`match` is `"vector"` when sqlite-vec is loaded, `"keyword"` otherwise.

---

## `forget`

Delete a memory by id.

**Input** `{ id: number }`.

**Returns** `{ deleted: boolean, id }`. Note: out-of-scope deletes
return `deleted: false` (the same as "id not found") so existence
is not leaked to tools without read access.

---

## `search_documents`

Semantic search over ingested document chunks.

**Input**
| Field | Type     | Notes                                   |
|-------|----------|-----------------------------------------|
| query | string   | Required.                               |
| scope | string?  | Must be readable if provided.           |
| limit | number?  | 1..25, default 10.                      |

**Returns** `{ hits: [{ documentId, title, scope, chunkIdx, content, score, match }] }`.

---

## `search_history`

Semantic search over imported conversation messages.

**Input**
| Field  | Type     | Notes                                                  |
|--------|----------|--------------------------------------------------------|
| query  | string   | Required.                                              |
| scope  | string?  | Must be readable if provided.                          |
| source | string?  | Filter by importer: `chatgpt`, `claude`, `gemini`, `generic`. |
| limit  | number?  | 1..50, default 10.                                     |

**Returns** `{ hits: [{ conversationId, source, title, scope, messageId, role, content, ts, score, match }] }`.

---

## `list_workspaces`

List workspaces the calling tool can read.

**Input** `{}`.

**Returns** `{ workspaces: [{ id, name, isActive, scope, createdAt }] }`.

---

## `get_active_workspace`

Return the active workspace if it is in a readable scope, otherwise
`null` (without leaking that an active workspace exists in another
scope).

**Input** `{}`.

**Returns** `{ workspace: Workspace | null }`.

---

## `add_to_workspace`

Append an item to a workspace. Requires write access on the workspace's
scope.

**Input**
| Field        | Type     | Notes                                             |
|--------------|----------|---------------------------------------------------|
| kind         | string   | Required. `task`, `goal`, `note`, `thread`, …    |
| content      | string   | Required.                                         |
| workspaceId  | number?  | Target id. Omit = active workspace.               |
| state        | string?  | Lifecycle (default `open`).                       |

**Returns** `{ item: WorkspaceItem }`.

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

### Any HTTP-speaking client

Run the server:
```
DARKCONTEXT_TOKEN=dcx_... dcx serve --http --port 4000
```

Clients POST JSON-RPC to `http://127.0.0.1:4000/mcp` with
`Authorization: Bearer dcx_...` and
`Accept: application/json, text/event-stream`.
