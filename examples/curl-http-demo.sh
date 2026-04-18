#!/usr/bin/env bash
# End-to-end HTTP demo: init store → mint a tool token → start the server
# → drive the MCP protocol with plain curl → inspect audit log → shutdown.
#
# Requires: dcx (npm install -g or local dist/), curl, jq.
set -euo pipefail

DB="${DB:-$(mktemp -d)/store.db}"
PORT="${PORT:-4141}"

echo "→ init store at $DB"
dcx init --db "$DB" >/dev/null

echo "→ provision a tool identity"
TOKEN="$(
  dcx tool add demo --scopes default --db "$DB" 2>&1 \
    | awk '/^  dcx_/ {print $1; exit}'
)"
echo "  token: $TOKEN"

echo "→ start HTTP server on 127.0.0.1:$PORT (background)"
DARKCONTEXT_TOKEN="$TOKEN" dcx serve --http --port "$PORT" --db "$DB" >/tmp/dcx-serve.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

# Wait for the bind to finish.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null; then break; fi
  sleep 0.2
done

echo "→ GET /healthz (no auth required)"
curl -s "http://127.0.0.1:$PORT/healthz" | jq .

MCP_URL="http://127.0.0.1:$PORT/mcp"
AUTH="Authorization: Bearer $TOKEN"
ACCEPT="Accept: application/json, text/event-stream"
CTYPE="Content-Type: application/json"

echo "→ initialize session"
curl -s -H "$AUTH" -H "$ACCEPT" -H "$CTYPE" -X POST "$MCP_URL" -d '{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": { "name": "curl-demo", "version": "0.0.1" }
  }
}' | jq '.result.serverInfo // .'

echo "→ tools/list"
curl -s -H "$AUTH" -H "$ACCEPT" -H "$CTYPE" -X POST "$MCP_URL" -d '{
  "jsonrpc": "2.0", "id": 2, "method": "tools/list"
}' | jq '.result.tools | map(.name)'

echo "→ call remember"
curl -s -H "$AUTH" -H "$ACCEPT" -H "$CTYPE" -X POST "$MCP_URL" -d '{
  "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": {
    "name": "remember",
    "arguments": { "content": "Espresso machine descales every 60 shots." }
  }
}' | jq '.result.structuredContent // .result'

echo "→ call recall"
curl -s -H "$AUTH" -H "$ACCEPT" -H "$CTYPE" -X POST "$MCP_URL" -d '{
  "jsonrpc": "2.0", "id": 4, "method": "tools/call",
  "params": {
    "name": "recall",
    "arguments": { "query": "how often descale" }
  }
}' | jq '.result.structuredContent // .result'

echo "→ audit log (CLI)"
dcx audit list --db "$DB" --limit 5

echo "→ shutdown"
# trap handles it
