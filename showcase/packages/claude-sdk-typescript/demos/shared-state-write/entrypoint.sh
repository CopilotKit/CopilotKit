#!/bin/bash
set -e

echo "[entrypoint] cell: claude-sdk-typescript / shared-state-write"
echo "[entrypoint] PORT=${PORT:-10000}"

# Start Claude agent backend on 8123
cd /app/backend
AGENT_PORT=8123 AGENT_HOST=0.0.0.0 \
  node_modules/.bin/tsx agent.ts 2>&1 | sed 's/^/[agent] /' &
AGENT_PID=$!
cd /app
sleep 2

if ! kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] ERROR: Claude agent failed to start"
fi

PORT=${PORT:-10000}
npx next start --port $PORT 2>&1 | sed 's/^/[nextjs] /' &
NEXTJS_PID=$!

wait -n
EXIT_CODE=$?
echo "[entrypoint] A process exited with code $EXIT_CODE"
exit $EXIT_CODE
