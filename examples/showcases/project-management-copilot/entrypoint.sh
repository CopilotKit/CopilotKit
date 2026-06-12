#!/bin/bash
set -e

echo "[entrypoint] Starting: langgraph-python starter"

if [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: OPENAI_API_KEY not set!"
else
  echo "[entrypoint] OPENAI_API_KEY: set"
fi

# Start agent via AG-UI protocol (serve.py wraps the original graph)
echo "[entrypoint] Starting agent on port 8123..."
AGENT_PORT=8123 python serve.py 2>&1 &
AGENT_PID=$!

sleep 3

# Start the CopilotKit BFF.
echo "[entrypoint] Starting BFF on port 4000..."
LANGGRAPH_DEPLOYMENT_URL=http://127.0.0.1:8123 PORT=4000 node apps/bff/dist/server.js 2>&1 &
BFF_PID=$!

# Start the Vite frontend server.
echo "[entrypoint] Starting frontend on port ${PORT:-3000}..."
COPILOTKIT_RUNTIME_URL=http://127.0.0.1:4000/api/copilotkit PORT=${PORT:-3000} node apps/app/server.mjs 2>&1 &
APP_PID=$!

echo "[entrypoint] Agent=$AGENT_PID BFF=$BFF_PID App=$APP_PID"
wait -n $AGENT_PID $BFF_PID $APP_PID
exit $?
