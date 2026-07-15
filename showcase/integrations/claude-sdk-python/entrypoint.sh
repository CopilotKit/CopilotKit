#!/bin/bash
set -e

cleanup() {
  kill $AGENT_PID $NEXTJS_PID $WATCHDOG_PID 2>/dev/null || true
}
trap cleanup EXIT

# Disable Python stdout buffering so the FastAPI/uvicorn agent flushes
# tracebacks and log lines immediately. Without this a silent crash during
# module import can sit in Python's userspace buffer until the process
# exits, by which point the container is already gone.
export PYTHONUNBUFFERED=1

# Route CVDIAG breadcrumbs off stdout to PocketBase when the durable sink is wired.
# A log-flood on stdout is what wedged the event loop (backed-up pipe -> blocking write).
# Only silence stdout when CVDIAG_PB_URL is set, so diagnostics are never lost when PB
# is absent. An explicit operator CVDIAG_LOG_STDOUT setting is always preserved.
if [ -n "${CVDIAG_PB_URL:-}" ]; then
  export CVDIAG_LOG_STDOUT="${CVDIAG_LOG_STDOUT:-0}"
fi

echo "========================================="
echo "[entrypoint] Starting showcase package: claude-sdk-python"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

if [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: OPENAI_API_KEY is not set! Agent will fail."
else
  echo "[entrypoint] OPENAI_API_KEY: set (${#OPENAI_API_KEY} chars)"
fi

# Start agent backend on :8000 with log prefixing so its output is
# distinguishable from Next.js in the Railway log stream.
#
# Belt-and-suspenders log flushing: `PYTHONUNBUFFERED=1` above exports the env
# var, but a child process could in principle un-export or override it. The
# `-u` flag to the Python interpreter forces unbuffered stdout/stderr at the
# interpreter level and is not overridable by user code. Combined with the
# `fflush()` inside the awk pipe below, this guarantees uvicorn request lines
# and tracebacks reach Railway's log stream line-at-a-time rather than
# block-buffered in pipe buffers.
echo "[entrypoint] Starting Python agent on port 8000..."
python -u -m uvicorn agent_server:app --host 0.0.0.0 --port 8000 --no-access-log &> >(awk '{print "[agent] " $0; fflush()}') &
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
# Scope NODE_ENV=production to the Next.js invocation ONLY, not the whole
# container environment. `ENV NODE_ENV=production` at the image level would
# leak into every child process (Python agent, shell, healthchecks). `env`
# prefix binds the value to this single exec.
env NODE_ENV=production npx next start --port $PORT &> >(awk '{print "[nextjs] " $0; fflush()}') &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"

# Watchdog: Railway deploys of showcase packages have been observed to hit a
# silent agent hang — the Python process stays alive (so `wait -n` never
# fires and the container never restarts) but stops responding on :8000.
# Poll the agent's /health endpoint every 30s; after 3 consecutive failures
# (90s of unreachable agent), kill the agent process so `wait -n` returns
# and Railway restarts the container. We kill the agent (not the whole
# script) first so `set -e` + `wait -n; exit $?` handles the restart
# through the normal path rather than a forced `exit` that would bypass
# logging. Generalized from showcase/integrations/crewai-crews/entrypoint.sh
# (PRs #4114 + #4115).
#
# Second guard (public front door): the same silent-hang class can wedge the
# PUBLIC Next.js listener on $PORT — the surface the BE probe and Railway
# healthcheck actually hit (`/api/health`). Under a stdout-backpressure stall
# the Node event loop parks in a blocking write(2) and stops serving, but the
# Next.js process stays alive so `wait -n` never fires and the agent-only
# guard above is satisfied (agent idle-alive on :8000) → indefinite wedge.
# Poll the public health surface on its own counter/cadence; on sustained
# failure emit a LOUD #oss-alerts Slack alert BEFORE killing, then kill
# $NEXTJS_PID so `wait -n` returns and Railway restarts the container.
(
  FAILS=0
  PUBLIC_FAILS=0
  while sleep 30; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      # Agent already dead — wait -n in the main shell will handle it.
      break
    fi
    if curl -fsS --max-time 5 http://127.0.0.1:8000/health > /dev/null 2>&1; then
      FAILS=0
    else
      FAILS=$((FAILS + 1))
      echo "[watchdog] Agent health probe failed (count=$FAILS)"
      if [ $FAILS -ge 3 ]; then
        WEDGE_ENV="${RAILWAY_ENVIRONMENT_NAME:-$(hostname)}"
        echo "[watchdog] Agent unresponsive for ~90s — killing PID $AGENT_PID to trigger container restart"
        # LOUD alert before we kill. Never let a failed/absent webhook crash
        # the watchdog — only attempt if the var is set, and swallow errors.
        if [ -n "$SLACK_WEBHOOK_OSS_ALERTS" ]; then
          curl -fsS -m 10 -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"[claude-sdk-python] env=${WEDGE_ENV} agent :8000 unresponsive ~90s — restarting (agent PID $AGENT_PID)\"}" \
            "$SLACK_WEBHOOK_OSS_ALERTS" > /dev/null 2>&1 || true
        fi
        kill -9 $AGENT_PID 2>/dev/null || true
        break
      fi
    fi

    # Public front door guard: poll the Next.js /api/health on $PORT.
    if curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/api/health" > /dev/null 2>&1; then
      PUBLIC_FAILS=0
    else
      PUBLIC_FAILS=$((PUBLIC_FAILS + 1))
      echo "[watchdog] Public /api/health probe failed on port $PORT (count=$PUBLIC_FAILS)"
      if [ $PUBLIC_FAILS -ge 3 ]; then
        WEDGE_ENV="${RAILWAY_ENVIRONMENT_NAME:-$(hostname)}"
        echo "[watchdog] Public port $PORT unresponsive for ~90s — killing PID $NEXTJS_PID to trigger container restart"
        # LOUD alert before we kill. Never let a failed/absent webhook crash
        # the watchdog — only attempt if the var is set, and swallow errors.
        if [ -n "$SLACK_WEBHOOK_OSS_ALERTS" ]; then
          curl -fsS -m 10 -X POST -H 'Content-type: application/json' \
            --data "{\"text\":\"[claude-sdk-python] env=${WEDGE_ENV} public \$PORT ($PORT) /api/health unresponsive ~90s — restarting (Next.js PID $NEXTJS_PID)\"}" \
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
