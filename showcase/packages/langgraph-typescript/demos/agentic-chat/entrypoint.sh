#!/bin/bash
set -e

echo "[entrypoint] cell: langgraph-typescript / agentic-chat"
echo "[entrypoint] PORT=${PORT:-10000}"

# Start LangGraph TS agent server in background (unbuffered stderr/stdout)
cd /agent
stdbuf -oL -eL npx @langchain/langgraph-cli dev --port 8123 --no-browser 2>&1 | sed -u 's/^/[langgraph] /' &
LANGGRAPH_PID=$!
sleep 3

if ! kill -0 $LANGGRAPH_PID 2>/dev/null; then
  echo "[entrypoint] ERROR: LangGraph agent server failed to start"
fi

PORT=${PORT:-10000}
cd /app
stdbuf -oL -eL npx next start --port $PORT 2>&1 | sed -u 's/^/[nextjs] /' &
NEXTJS_PID=$!

wait -n
EXIT_CODE=$?
echo "[entrypoint] A process exited with code $EXIT_CODE"
exit $EXIT_CODE
