#!/bin/bash
set -e

echo "[entrypoint] cell: crewai-crews / agentic-chat"
echo "[entrypoint] PORT=${PORT:-10000}"

cd /app/backend
python -m uvicorn agent_server:app --host 0.0.0.0 --port 8000 > >(sed 's/^/[crewai] /') 2>&1 &
CREWAI_PID=$!
cd /app
sleep 3

if ! kill -0 $CREWAI_PID 2>/dev/null; then
  echo "[entrypoint] ERROR: CrewAI agent server failed to start"
fi

PORT=${PORT:-10000}
npx next start --port $PORT > >(sed 's/^/[nextjs] /') 2>&1 &
NEXTJS_PID=$!

wait -n
EXIT_CODE=$?
echo "[entrypoint] A process exited with code $EXIT_CODE"
exit $EXIT_CODE
