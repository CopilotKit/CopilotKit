#!/bin/bash
set -e

echo "[entrypoint] cell: pydantic-ai / shared-state-write"
echo "[entrypoint] PORT=${PORT:-10000}"

# Run the PydanticAI agent on 8000. AGENT_URL for the frontend defaults to
# http://localhost:8000 (see frontend/src/app/api/copilotkit/route.ts).
(cd backend && python -m uvicorn server:app --host 0.0.0.0 --port 8000 2>&1 | sed 's/^/[agent] /') &
AGENT_PID=$!
sleep 2

if ! kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] ERROR: PydanticAI agent server failed to start"
fi

PORT=${PORT:-10000}
npx next start --port $PORT 2>&1 | sed 's/^/[nextjs] /' &
NEXTJS_PID=$!

wait -n
EXIT_CODE=$?
echo "[entrypoint] A process exited with code $EXIT_CODE"
exit $EXIT_CODE
