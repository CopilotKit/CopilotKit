#!/bin/bash
set -e

echo "========================================="
echo "[entrypoint] PORT=${PORT:-10000}"
echo "[entrypoint] Starting LangGraph agent server on :8123..."
echo "[entrypoint] Starting Next.js frontend..."
echo "========================================="

# Start LangGraph agent server in background
cd /app/src/agent && npx @langchain/langgraph-cli dev --port 8123 --no-browser &

# Start Next.js frontend
cd /app && exec npx next start --port "${PORT:-10000}"
