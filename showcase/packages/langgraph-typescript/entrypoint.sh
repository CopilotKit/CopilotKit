#!/bin/bash
set -e

echo "========================================="
echo "[entrypoint] PORT=${PORT:-10000}"
echo "[entrypoint] Starting LangGraph agent server on :8123..."
echo "[entrypoint] Starting Next.js frontend..."
echo "========================================="

# Start LangGraph agent server in background.
# --host 0.0.0.0 binds IPv4 + IPv6 so the Next.js frontend can reach the agent
# regardless of how `localhost` resolves in the container. Default is 'localhost'
# which on modern Node resolves IPv6-first (::1), leaving the IPv4 loopback
# unbound and causing 503s from the frontend's /api/health probe.
cd /app/src/agent && npx @langchain/langgraph-cli dev --port 8123 --host 0.0.0.0 --no-browser &

# Start Next.js frontend
cd /app && exec npx next start --port "${PORT:-10000}"
