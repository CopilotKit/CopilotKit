#!/bin/bash
set -e

echo "[entrypoint] Starting agent backend on port 8000..."
python -m uvicorn agent_server:app --host 0.0.0.0 --port 8000 2>&1 &
AGENT_PID=$!

echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
npx next start --port ${PORT:-10000} 2>&1 &
NEXT_PID=$!

echo "[entrypoint] Agent PID=$AGENT_PID, Next PID=$NEXT_PID"

# Wait for either process to exit
wait -n
EXIT_CODE=$?
echo "[entrypoint] Process exited with code $EXIT_CODE"
exit $EXIT_CODE
