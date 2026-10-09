#!/bin/bash
set -e

# Start .NET agent on port 8000
cd /app/agent
ASPNETCORE_URLS="http://0.0.0.0:8000" ./ProverbsAgent &
AGENT_PID=$!
cd /app

# Start Next.js frontend
PORT="${PORT:-3000}"
export PORT
npx next start --port "$PORT" &
NEXT_PID=$!

wait -n $AGENT_PID $NEXT_PID
EXIT_CODE=$?
kill $AGENT_PID $NEXT_PID 2>/dev/null || true
exit $EXIT_CODE
