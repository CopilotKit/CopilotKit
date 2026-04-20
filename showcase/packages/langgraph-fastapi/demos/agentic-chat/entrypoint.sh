#!/bin/bash
set -e

echo "[entrypoint] cell: langgraph-fastapi / agentic-chat"
echo "[entrypoint] PORT=${PORT:-10000}"

python -m langgraph_cli dev \
  --config langgraph.json \
  --host 0.0.0.0 \
  --port 8123 \
  --no-browser > >(sed 's/^/[langgraph] /') 2>&1 &
LANGGRAPH_PID=$!
sleep 3

if ! kill -0 $LANGGRAPH_PID 2>/dev/null; then
  echo "[entrypoint] ERROR: LangGraph agent server failed to start"
fi

PORT=${PORT:-10000}
npx next start --port $PORT > >(sed 's/^/[nextjs] /') 2>&1 &
NEXTJS_PID=$!

wait -n
EXIT_CODE=$?
echo "[entrypoint] A process exited with code $EXIT_CODE"
exit $EXIT_CODE
