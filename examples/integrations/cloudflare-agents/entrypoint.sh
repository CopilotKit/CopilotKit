#!/bin/bash
set -e

echo "[entrypoint] Starting: cloudflare-agents starter"

if [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: OPENAI_API_KEY not set!"
else
  echo "[entrypoint] OPENAI_API_KEY: set"
fi

# Point the Next.js runtime at the Worker inside this container.
export AGENT_URL="${AGENT_URL:-http://127.0.0.1:8000}"

# Start the agent: the Cloudflare Worker on workerd (wrangler dev) on :8000.
# CLOUDFLARE_INCLUDE_PROCESS_ENV hands the container environment
# (OPENAI_API_KEY, OPENAI_BASE_URL, COPILOTKIT_AGENT_MODEL) to the Worker as
# bindings, so the key never appears on a command line. CI and
# WRANGLER_SEND_METRICS keep wrangler non-interactive and offline.
echo "[entrypoint] Starting the Worker on port 8000..."
(cd agent && CLOUDFLARE_INCLUDE_PROCESS_ENV=true CI=true WRANGLER_SEND_METRICS=false \
  npx wrangler dev --ip 127.0.0.1 --port 8000 --show-interactive-dev-session=false 2>&1) &
AGENT_PID=$!

# Wait (bounded) until the Worker answers, so the app starts with its agent up.
for _ in $(seq 1 60); do
  if node -e "require('http').get('http://127.0.0.1:8000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"; then
    echo "[entrypoint] Worker is up"
    break
  fi
  sleep 1
done

# Start Next.js. This image is a non-standalone build (.next + node_modules +
# package.json), so serve via `next start`, not standalone server.js.
echo "[entrypoint] Starting Next.js on port ${PORT:-3000}..."
PORT="${PORT:-3000}"
export PORT HOSTNAME=0.0.0.0
NODE_ENV=production ./node_modules/.bin/next start -H 0.0.0.0 -p "$PORT" 2>&1 &
NEXT_PID=$!

echo "[entrypoint] Agent=$AGENT_PID Next=$NEXT_PID"
wait -n $AGENT_PID $NEXT_PID
exit $?
