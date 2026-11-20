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
# Instrumentation: package-claude-sdk-typescript health probes fail on
# Railway but process claims to listen — narrow the cold-start window by
# logging immediately before node exec so we can compare against the
# agent_server.ts module-loaded / pre-Anthropic / listening prints below.
echo "[entrypoint] pre-node $(date -u +%Y-%m-%dT%H:%M:%SZ)"
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
# showcase/integrations/crewai-crews/entrypoint.sh (PRs #4114 + #4115).
#
# Startup grace: `node /app/agent_server.js` runs the compiled
# @anthropic-ai/claude-agent-sdk bundle and was observed restart-looping
# on Railway starting 04-20 16:54 UTC — the 90s (3-strike) budget was
# shorter than the cold-start path on a fresh container. Wait up to 180s
# for the first successful health probe before arming the strike counter
# so slow cold-starts aren't killed in a loop.
(
  GRACE=180
  echo "[watchdog] Startup grace: waiting up to ${GRACE}s for first successful health probe before arming strike counter"
  ELAPSED=0
  while [ $ELAPSED -lt $GRACE ]; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      # Agent died during startup — wait -n in the main shell will handle it.
      exit 0
    fi
    if curl -fsS --max-time 5 http://127.0.0.1:8000/health > /dev/null 2>&1; then
      echo "[watchdog] Agent healthy after ${ELAPSED}s — arming strike counter"
      break
    fi
    sleep 5
    ELAPSED=$((ELAPSED + 5))
  done
  if [ $ELAPSED -ge $GRACE ]; then
    echo "[watchdog] Grace window elapsed without successful probe — arming strike counter anyway"
  fi
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
            --data "{\"text\":\"[claude-sdk-typescript] env=${WEDGE_ENV} public \$PORT (${PORT}) /api/health unresponsive ~90s — restarting (Next.js PID $NEXTJS_PID)\"}" \
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
