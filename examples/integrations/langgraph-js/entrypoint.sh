#!/bin/bash
set -e

# Start LangGraph agent server on port 8123
cd /app/apps/agent
npx @langchain/langgraph-cli dev --port 8123 --no-browser &
AGENT_PID=$!
cd /app

sleep 3

# Start Next.js frontend
cd /app/apps/web
PORT=${PORT:-3000} npx next start --port ${PORT:-3000} &
NEXT_PID=$!
cd /app

wait -n $AGENT_PID $NEXT_PID
EXIT_CODE=$?
kill $AGENT_PID $NEXT_PID 2>/dev/null || true
exit $EXIT_CODE
