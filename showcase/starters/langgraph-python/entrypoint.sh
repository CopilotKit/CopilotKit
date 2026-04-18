#!/bin/bash
# Template variables (substituted by generate-starters.ts):
#   SLUG             — framework slug (e.g. "langgraph-python")
#   DEV_SCRIPT_BLOCK — language-specific agent startup block
set -e

cleanup() {
  kill $AGENT_PID $NEXTJS_PID 2>/dev/null
}
trap cleanup EXIT

echo "========================================="
echo "[entrypoint] Starting showcase: langgraph-python"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

# Check critical env vars
if [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: OPENAI_API_KEY is not set! Agent will fail."
else
  echo "[entrypoint] OPENAI_API_KEY: set (${#OPENAI_API_KEY} chars)"
fi

echo "[entrypoint] Starting LangGraph agent server on port 8123..."
python -m langgraph_cli dev \
  --config langgraph.json \
  --host 0.0.0.0 \
  --port 8123 \
  --no-browser 2>&1 | sed 's/^/[agent] /' &
AGENT_PID=$!
sleep 3
if kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] Agent server started (PID: $AGENT_PID)"
else
  echo "[entrypoint] ERROR: Agent server failed to start — exiting"
  exit 1
fi

echo "========================================="
echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
echo "========================================="

PORT=${PORT:-10000}
# Inject NODE_ENV=production ONLY into the Next.js invocation, not the whole
# container environment. A global `ENV NODE_ENV=production` in the Dockerfile
# would silently disable the aimock toggle inside the Python process as well
# (aimock_toggle.py refuses to apply when NODE_ENV=production) — which breaks
# Docker-based smoke tests that rely on AIMOCK_URL. The Python agent spawned
# above inherits no NODE_ENV, so the prod guard only fires when the operator
# explicitly exports NODE_ENV / ENV on the container.
NODE_ENV=production npx next start --port $PORT 2>&1 | sed 's/^/[nextjs] /' &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"
echo "[entrypoint] Both processes running. Waiting..."

wait -n $AGENT_PID $NEXTJS_PID
EXIT_CODE=$?
if ! kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] Agent process (PID: $AGENT_PID) exited with code $EXIT_CODE"
elif ! kill -0 $NEXTJS_PID 2>/dev/null; then
  echo "[entrypoint] Next.js process (PID: $NEXTJS_PID) exited with code $EXIT_CODE"
else
  echo "[entrypoint] A process exited with code $EXIT_CODE"
fi

# Clean up surviving process
kill $AGENT_PID $NEXTJS_PID 2>/dev/null
exit $EXIT_CODE
