#!/usr/bin/env bash
#
# mcp-query.sh
#
# Queries the CopilotKit MCP server (mcp.copilotkit.ai) using the JSON-RPC
# over HTTP+SSE protocol. Handles the MCP handshake (initialize) and then
# calls the search-docs tool.
#
# Usage:
#   ./scripts/mcp-query.sh <query> [limit]
#
# Arguments:
#   query   Search query string
#   limit   Max results (default: 5)
#
# Output:
#   The search results text on stdout.
#   Exit code 0 on success, 1 on failure (with warnings on stderr).

set -euo pipefail

MCP_URL="https://mcp.copilotkit.ai/mcp"
QUERY="${1:?Usage: $0 <query> [limit]}"
LIMIT="${2:-5}"

# Step 1: Initialize the MCP session
init_response=$(curl -sf "$MCP_URL" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -D /tmp/mcp-headers-$$ \
    --max-time 15 \
    -d '{
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "copilotkit-skills-ci",
                "version": "1.0.0"
            }
        }
    }' 2>/dev/null) || {
    echo "WARNING: MCP initialize request failed" >&2
    rm -f /tmp/mcp-headers-$$
    exit 1
}

# Extract session ID from response headers
session_id=$(grep -i '^Mcp-Session-Id:' /tmp/mcp-headers-$$ 2>/dev/null | sed 's/^[^:]*: *//;s/\r$//' || true)
rm -f /tmp/mcp-headers-$$

if [ -z "$session_id" ]; then
    echo "WARNING: No Mcp-Session-Id in initialize response" >&2
    exit 1
fi

# Step 2: Call the search-docs tool
# Escape the query for JSON
query_json=$(printf '%s' "$QUERY" | jq -Rs .)

tool_response=$(curl -sf "$MCP_URL" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Mcp-Session-Id: ${session_id}" \
    --max-time 15 \
    -d "{
        \"jsonrpc\": \"2.0\",
        \"id\": 2,
        \"method\": \"tools/call\",
        \"params\": {
            \"name\": \"search-docs\",
            \"arguments\": {
                \"query\": ${query_json},
                \"limit\": ${LIMIT}
            }
        }
    }" 2>/dev/null) || {
    echo "WARNING: MCP tools/call request failed" >&2
    exit 1
}

# Step 3: Parse the response
# MCP responses may be SSE (text/event-stream) or plain JSON-RPC.
# For SSE, extract the data lines; for JSON, use directly.
if echo "$tool_response" | grep -q '^data:'; then
    # SSE format: extract data lines, find the JSON-RPC result
    result=$(echo "$tool_response" \
        | grep '^data:' \
        | sed 's/^data: *//' \
        | jq -rs '[.[] | select(.result != null)] | .[0].result.content[0].text // empty')
else
    # Plain JSON-RPC response
    result=$(echo "$tool_response" | jq -r '.result.content[0].text // empty')
fi

if [ -z "$result" ]; then
    echo "WARNING: Empty result from MCP search-docs" >&2
    exit 1
fi

echo "$result"
