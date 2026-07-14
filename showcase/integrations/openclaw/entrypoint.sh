#!/bin/bash
# Runs BOTH the OpenClaw gateway (with the forked ag-ui plugin) and the
# Next.js frontend in one container. Modeled on the other showcase integrations
# (e.g. ag2/entrypoint.sh): backend on an internal port, frontend on :10000,
# watchdog restarts the container if the backend goes unresponsive.
set -e

cleanup() { kill "$GATEWAY_PID" "$NEXTJS_PID" "$WATCHDOG_PID" 2>/dev/null || true; }
trap cleanup EXIT

GW_PORT="${OPENCLAW_GATEWAY_PORT:-8000}"
PORT="${PORT:-10000}"

echo "========================================="
echo "[entrypoint] Showcase package: openclaw"
echo "[entrypoint] gateway :$GW_PORT  frontend :$PORT"
echo "========================================="
[ -z "${OPENAI_API_KEY:-}" ] && echo "[entrypoint] WARNING: OPENAI_API_KEY not set — agent will fail."

# 1. Headless-configure OpenClaw (token, model, forked plugin, aimock base URL).
./gateway/setup.sh

# 2. Start the OpenClaw gateway on the internal port.
echo "[entrypoint] starting OpenClaw gateway on :$GW_PORT ..."
openclaw gateway run --force &> >(awk '{print "[gateway] " $0; fflush()}') &
GATEWAY_PID=$!

# Wait for the gateway HTTP server (GET / returns 200 once ready).
for _ in $(seq 1 90); do
  curl -fsS --max-time 3 "http://127.0.0.1:$GW_PORT/" >/dev/null 2>&1 && break
  kill -0 "$GATEWAY_PID" 2>/dev/null || { echo "[entrypoint] ERROR: gateway exited during startup"; exit 1; }
  sleep 1
done
echo "[entrypoint] gateway ready (PID $GATEWAY_PID)"

# 3. Start the Next.js frontend. NODE_ENV scoped to this exec only (not the gateway).
echo "[entrypoint] starting Next.js on :$PORT ..."
env NODE_ENV=production npx next start --port "$PORT" &> >(awk '{print "[nextjs] " $0; fflush()}') &
NEXTJS_PID=$!

# 4. Watchdog: if the gateway stops responding for ~90s, kill it so `wait -n`
# returns and the platform restarts the container.
(
  FAILS=0
  while sleep 30; do
    kill -0 "$GATEWAY_PID" 2>/dev/null || break
    if curl -fsS --max-time 5 "http://127.0.0.1:$GW_PORT/" >/dev/null 2>&1; then
      FAILS=0
    else
      FAILS=$((FAILS + 1))
      echo "[watchdog] gateway health probe failed (count=$FAILS)"
      [ "$FAILS" -ge 3 ] && { echo "[watchdog] gateway unresponsive — killing to trigger restart"; kill -9 "$GATEWAY_PID" 2>/dev/null || true; break; }
    fi
  done
) &
WATCHDOG_PID=$!

echo "[entrypoint] all processes running; waiting..."
wait -n "$GATEWAY_PID" "$NEXTJS_PID"
EXIT_CODE=$?
echo "[entrypoint] a process exited with code $EXIT_CODE"
exit $EXIT_CODE
