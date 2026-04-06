#!/bin/bash
set -e

# Start Python agent on port 8000 (override PORT which Railway sets to 3000)
cd /app/agent
PYTHONPATH=/app/agent/src PORT=8000 /app/agent/.venv/bin/python -m uvicorn src.main:app --host 0.0.0.0 --port 8000 &
AGENT_PID=$!
cd /app

# Start Next.js frontend
PORT=${PORT:-3000} npx next start --port ${PORT:-3000} &
NEXT_PID=$!

wait -n $AGENT_PID $NEXT_PID
EXIT_CODE=$?
kill $AGENT_PID $NEXT_PID 2>/dev/null || true
exit $EXIT_CODE
