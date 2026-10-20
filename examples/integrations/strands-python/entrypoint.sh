#!/bin/bash
set -e

echo "[entrypoint] Starting: strands-python starter"

if [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: OPENAI_API_KEY not set!"
else
  echo "[entrypoint] OPENAI_API_KEY: set"
fi

# Point the Next.js runtime at the agent's port (the agent runs on 8123 in this
# single-container image; the route defaults to 8000 otherwise).
export AGENT_URL="${AGENT_URL:-http://localhost:8123}"

# Start the Strands agent via AG-UI protocol.
# Invoke uvicorn directly rather than `python main.py`: main.py's __main__ block
# is the dev entry point and enables reload=True, which would start a StatReload
# file watcher inside this production image. Mirrors claude-sdk-python.
echo "[entrypoint] Starting agent on port 8123..."
(cd agent && AGENT_PORT=8123 uv run uvicorn main:app --host 0.0.0.0 --port 8123 2>&1) &
AGENT_PID=$!

sleep 3

# Start Next.js. This image is a non-standalone build (.next + node_modules +
# package.json), so serve via `next start`, not standalone server.js.
echo "[entrypoint] Starting Next.js on port ${PORT:-3000}..."
PORT="${PORT:-3000}"
export PORT HOSTNAME=0.0.0.0
./node_modules/.bin/next start -H 0.0.0.0 -p "$PORT" 2>&1 &
NEXT_PID=$!

echo "[entrypoint] Agent=$AGENT_PID Next=$NEXT_PID"
wait -n $AGENT_PID $NEXT_PID
exit $?
