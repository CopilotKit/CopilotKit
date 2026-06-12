#!/bin/bash
set -e

echo "[entrypoint] Starting: strands-python starter"

if [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: OPENAI_API_KEY not set!"
else
  echo "[entrypoint] OPENAI_API_KEY: set"
fi

# Start the Strands agent via AG-UI protocol.
# main.py is self-serving (uvicorn on AGENT_PORT); run it from the uv venv.
echo "[entrypoint] Starting agent on port 8123..."
(cd agent && AGENT_PORT=8123 uv run python main.py 2>&1) &
AGENT_PID=$!

sleep 3

# Start Next.js. This image is a non-standalone build (.next + node_modules +
# package.json), so serve via `next start`, not standalone server.js.
echo "[entrypoint] Starting Next.js on port ${PORT:-3000}..."
HOSTNAME=0.0.0.0 PORT=${PORT:-3000} ./node_modules/.bin/next start -H 0.0.0.0 -p "${PORT:-3000}" 2>&1 &
NEXT_PID=$!

echo "[entrypoint] Agent=$AGENT_PID Next=$NEXT_PID"
wait -n $AGENT_PID $NEXT_PID
exit $?
