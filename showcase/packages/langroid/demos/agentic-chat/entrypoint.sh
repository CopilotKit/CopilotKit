#!/bin/bash
set -e

echo "[entrypoint] cell: langroid / agentic-chat"
echo "[entrypoint] PORT=${PORT:-10000}"

# Start Langroid agent backend (FastAPI + uvicorn on :8000)
python -m uvicorn agent_server:app \
  --app-dir backend \
  --host 0.0.0.0 \
  --port 8000 2>&1 | sed 's/^/[langroid] /' &
AGENT_PID=$!
sleep 3

if ! kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] ERROR: Langroid agent server failed to start"
fi

PORT=${PORT:-10000}
npx next start --port $PORT 2>&1 | sed 's/^/[nextjs] /' &
NEXTJS_PID=$!

wait -n
EXIT_CODE=$?
echo "[entrypoint] A process exited with code $EXIT_CODE"
exit $EXIT_CODE
