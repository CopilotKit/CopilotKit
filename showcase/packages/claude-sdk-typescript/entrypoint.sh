#!/bin/bash
set -e

cleanup() {
  kill $AGENT_PID $NEXTJS_PID $WATCHDOG_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "========================================="
echo "[entrypoint] Starting showcase package: claude-sdk-typescript"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "[entrypoint] WARNING: ANTHROPIC_API_KEY is not set! Agent will fail."
else
  echo "[entrypoint] ANTHROPIC_API_KEY: set (${#ANTHROPIC_API_KEY} chars)"
fi

# Start Claude agent backend (TypeScript, compiled to JS).
# Log prefixing uses bash process substitution (`&> >(awk …)`) rather than a
# pipe (`| sed …`): process substitution leaves `$!` pointing at the real
# node process, so `wait -n $AGENT_PID` monitors the right thing.
# `awk` with `fflush()` line-flushes each prefixed line to the container log.
echo "[entrypoint] Starting Claude agent on port 8000..."
node /app/agent_server.js &> >(awk '{print "[agent] " $0; fflush()}') &
AGENT_PID=$!
sleep 2
if kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] Agent started (PID: $AGENT_PID)"
else
  echo "[entrypoint] ERROR: Agent failed to start — exiting"
  exit 1
fi

echo "========================================="
echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
echo "========================================="

PORT=${PORT:-10000}
env NODE_ENV=production npx next start --port $PORT &> >(awk '{print "[nextjs] " $0; fflush()}') &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"

# Watchdog: Railway deploys of showcase packages have been observed to hit a
# silent agent hang — the agent process stays alive (so `wait -n` never
# fires and the container never restarts) but stops responding on :8000.
# Poll the agent's /health endpoint every 30s; after 3 consecutive failures
# (~90s of unreachable agent), kill the agent process so `wait -n` returns
# and Railway restarts the container. Generalized from
# showcase/packages/crewai-crews/entrypoint.sh (PRs #4114 + #4115).
(
  FAILS=0
  while sleep 30; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      break
    fi
    if curl -fsS --max-time 5 http://127.0.0.1:8000/health > /dev/null 2>&1; then
      FAILS=0
    else
      FAILS=$((FAILS + 1))
      echo "[watchdog] Agent health probe failed (count=$FAILS)"
      if [ $FAILS -ge 3 ]; then
        echo "[watchdog] Agent unresponsive for ~90s — killing PID $AGENT_PID to trigger container restart"
        kill -9 $AGENT_PID 2>/dev/null || true
        break
      fi
    fi
  done
) &
WATCHDOG_PID=$!

echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID)"
echo "[entrypoint] All processes running. Waiting..."

wait -n $AGENT_PID $NEXTJS_PID
EXIT_CODE=$?
if ! kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] Agent (PID: $AGENT_PID) exited with code $EXIT_CODE"
elif ! kill -0 $NEXTJS_PID 2>/dev/null; then
  echo "[entrypoint] Next.js (PID: $NEXTJS_PID) exited with code $EXIT_CODE"
else
  echo "[entrypoint] A process exited with code $EXIT_CODE"
fi

exit $EXIT_CODE
