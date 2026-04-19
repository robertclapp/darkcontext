#!/usr/bin/env bash
# End-to-end HTTP demo: init store → mint a tool token → start the server
# → drive the MCP protocol with plain curl → inspect audit log → shutdown.
#
# Requires: dcx (npm install -g or local dist/), curl, jq.
set -euo pipefail

# When the caller supplies DB, honor their path and don't touch its
# directory. When they don't, we mint a fresh tempdir and REMEMBER that
# we own it, so the EXIT trap can clean it up — previously every demo
# run leaked a directory under /tmp.
OWN_TMPDIR=""
if [ -z "${DB:-}" ]; then
  OWN_TMPDIR="$(mktemp -d)"
  DB="$OWN_TMPDIR/store.db"
fi
PORT="${PORT:-4141}"

echo "→ init store at $DB"
dcx init --db "$DB" >/dev/null

echo "→ provision a tool identity"
# `dcx tool add --json` emits a single parseable object; piping through
# jq is much more robust than awk-ing the human banner (which is what
# this script did pre-0.2 and what review correctly flagged as brittle).
PROVISION_JSON="$(dcx tool add demo --scopes default --json --db "$DB")"
TOKEN="$(echo "$PROVISION_JSON" | jq -r '.token')"
echo "  token: $TOKEN"

echo "→ start HTTP server on 127.0.0.1:$PORT (background)"
DARKCONTEXT_TOKEN="$TOKEN" dcx serve --http --port "$PORT" --db "$DB" >/tmp/dcx-serve.log 2>&1 &
SERVER_PID=$!
# Handle interactive interrupts (Ctrl+C → SIGINT) and termination (SIGTERM)
# alongside the normal EXIT path so the background server never outlives
# the demo script, and so the tempdir we own (if any) is cleaned up.
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  if [ -n "$OWN_TMPDIR" ]; then
    rm -rf "$OWN_TMPDIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Poll /healthz until bind completes. Loud failure if we give up — silent
# exit made the downstream curl errors confusing to debug.
READY=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null; then READY=1; break; fi
  sleep 0.2
done
if [ "$READY" -eq 0 ]; then
  echo "ERROR: dcx serve --http did not bind 127.0.0.1:$PORT within 2s" >&2
  echo "       see /tmp/dcx-serve.log for details" >&2
  exit 1
fi

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
