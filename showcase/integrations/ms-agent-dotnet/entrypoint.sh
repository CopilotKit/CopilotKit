#!/bin/bash
set -e

cleanup() {
  kill $AGENT_PID $NEXTJS_PID $WATCHDOG_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "========================================="
echo "[entrypoint] Starting showcase package: ms-agent-dotnet"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

if [ -z "$AZURE_OPENAI_API_KEY" ] && [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: Neither AZURE_OPENAI_API_KEY nor OPENAI_API_KEY is set! Agent will fail."
fi

# Start .NET agent backend on :8000 with log prefixing so its output is
# distinguishable from Next.js in the Railway log stream.
# `awk ... fflush()` line-flushes each prefixed line to the container log.
echo "[entrypoint] Starting .NET agent on port 8000..."
dotnet /agent/ProverbsAgent.dll --urls "http://0.0.0.0:8000" &> >(awk '{print "[agent] " $0; fflush()}') &
AGENT_PID=$!
sleep 3
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
# showcase/integrations/crewai-crews/entrypoint.sh (PRs #4114 + #4115).
(
  FAILS=0
  PUBLIC_FAILS=0
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

    # Public front door guard. The same silent-hang class that wedges the
    # agent can wedge the PUBLIC Next.js listener on $PORT — the surface real
    # users and the Railway healthcheck actually hit (`/api/health`). The Node
    # event loop parks in a blocking write(2) and stops serving, but the
    # process stays alive: `wait -n` never fires AND the agent probe above is
    # satisfied (agent idle-alive), so nothing restarts the container. Poll the
    # public surface on its own counter, same tick, and page #oss-alerts BEFORE
    # killing $NEXTJS_PID so the restart is never silent. Ported from
    # showcase/integrations/claude-sdk-python/entrypoint.sh.
    if curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/api/health" > /dev/null 2>&1; then
      PUBLIC_FAILS=0
    else
      PUBLIC_FAILS=$((PUBLIC_FAILS + 1))
      echo "[watchdog] Public /api/health probe failed on port ${PORT} (count=$PUBLIC_FAILS)"
      if [ $PUBLIC_FAILS -ge 3 ]; then
        WEDGE_ENV="${RAILWAY_ENVIRONMENT_NAME:-$(hostname)}"
        echo "[watchdog] Public port ${PORT} unresponsive for ~90s — killing PID $NEXTJS_PID to trigger container restart"
        # LOUD alert before we kill. Never let a failed or absent webhook
        # crash the watchdog — only attempt if the var is set, swallow errors.
        if [ -n "$SLACK_WEBHOOK_OSS_ALERTS" ]; then
          curl -fsS -m 10 -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"[ms-agent-dotnet] env=${WEDGE_ENV} public \$PORT (${PORT}) /api/health unresponsive ~90s — restarting (Next.js PID $NEXTJS_PID)\"}" \
            "$SLACK_WEBHOOK_OSS_ALERTS" > /dev/null 2>&1 || true
        fi
        kill -9 $NEXTJS_PID 2>/dev/null || true
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
