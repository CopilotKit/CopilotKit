#!/bin/bash
set -e

echo "[entrypoint] Starting LangGraph agent server on port 8123..."
python -m langgraph_cli dev \
  --config langgraph.json \
  --host 0.0.0.0 \
  --port 8123 \
  --no-browser 2>&1 &
AGENT_PID=$!

sleep 3

echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
npx next start --port ${PORT:-10000} 2>&1 &
NEXT_PID=$!

echo "[entrypoint] Agent PID=$AGENT_PID, Next PID=$NEXT_PID"
wait -n
exit $?
