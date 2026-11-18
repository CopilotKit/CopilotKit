#!/bin/bash
set -e

# Start the Python CrewAI agent on 8000. PORT belongs to the Next.js frontend
# (Railway injects it; staging uses 8080), so pin the agent explicitly here.
# Invoke uvicorn directly rather than `python server.py`: server.py's main() is
# the dev entry point and enables reload=True, which would start a StatReload
# file watcher inside this production image.
cd /app/agent
PORT=8000 python -m uvicorn server:app --host 0.0.0.0 --port 8000 &
AGENT_PID=$!

# Start the Next.js frontend
cd /app
npx next start -p "${PORT:-3000}" &
NEXT_PID=$!

wait -n $AGENT_PID $NEXT_PID
EXIT_CODE=$?
kill $AGENT_PID $NEXT_PID 2>/dev/null || true
exit $EXIT_CODE
