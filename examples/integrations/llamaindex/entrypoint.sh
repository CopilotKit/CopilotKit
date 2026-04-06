#!/bin/bash
set -e

# Start Python agent on port 9000 (llamaindex uses port 9000 by default)
cd /app/agent
PORT=9000 /app/agent/.venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 9000 &
AGENT_PID=$!
cd /app

# Start Next.js frontend
PORT=${PORT:-3000} npx next start --port ${PORT:-3000} &
NEXT_PID=$!

wait -n $AGENT_PID $NEXT_PID
EXIT_CODE=$?
kill $AGENT_PID $NEXT_PID 2>/dev/null || true
exit $EXIT_CODE
