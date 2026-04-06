#!/bin/bash
set -e

# Start the Python CrewAI agent (override PORT to 8000 — Railway sets PORT=3000 for the frontend)
cd /app/agent
PORT=8000 python server.py &
AGENT_PID=$!

# Start the Next.js frontend
cd /app
npx next start -p ${PORT:-3000} &
NEXT_PID=$!

wait -n $AGENT_PID $NEXT_PID
EXIT_CODE=$?
kill $AGENT_PID $NEXT_PID 2>/dev/null || true
exit $EXIT_CODE
