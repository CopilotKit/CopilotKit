#!/bin/bash
# Template variables (substituted by generate-starters.ts):
#   SLUG             — framework slug (e.g. "langgraph-python")
#   DEV_SCRIPT_BLOCK — language-specific agent startup block
#   WATCHDOG_BLOCK   — silent-hang watchdog (polls agent /health; kills on stall)
set -e

cleanup() {
  kill $AGENT_PID $NEXTJS_PID $WATCHDOG_PID 2>/dev/null
}
trap cleanup EXIT

# Disable Python stdout buffering so Python-based agents flush tracebacks
# and log lines to awk (and the container log) the moment they're written.
# Previously a silent crash during module import would sit in Python's
# userspace buffer until the process exited, by which point the pipe to the
# log prefixer had already closed and the error was lost. Harmless for
# non-Python frameworks (Java/Node/.NET ignore PYTHONUNBUFFERED).
export PYTHONUNBUFFERED=1

echo "========================================="
echo "[entrypoint] Starting showcase: strands"
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

echo "[entrypoint] Starting Python agent server on port 8123..."
cd /app && python -u -m uvicorn agent_server:app --host 0.0.0.0 --port 8123 &> >(awk '{print "[agent] " $0; fflush()}') &
AGENT_PID=$!
sleep 2
if kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] Agent server started (PID: $AGENT_PID)"
else
  echo "[entrypoint] ERROR: Agent server failed to start — exiting"
  exit 1
fi

# Watchdog: Railway deploys of showcase starters have been observed to hit a
# silent agent hang — the agent process stays alive (so `wait -n` never
# fires and the container never restarts) but stops responding on its health
# endpoint. Poll every 30s; after 3 consecutive failures (~90s of
# unreachable agent), kill the agent so `wait -n` returns and the platform
# restarts the container. We kill the agent (not the whole script) so
# `set -e` + `wait -n; exit $?` handles the restart through the normal
# path rather than a forced `exit` that bypasses logging.
#
# Some frameworks (langgraph-*) have slow cold-start paths that can exceed
# the 90s strike budget on a fresh Railway container. For those, an
# initial startup-grace window waits for the first healthy probe (or a
# per-framework ceiling) before the strike counter is armed. See
# getWatchdogGraceSeconds() for the mapping.
(
  FAILS=0
  while sleep 30; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      # Agent already dead — wait -n in the main shell will handle it.
      break
    fi
    if curl -fsS --max-time 5 http://127.0.0.1:8123/health > /dev/null 2>&1; then
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
echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID, probing http://127.0.0.1:8123/health)"

echo "========================================="
echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
echo "========================================="

PORT=${PORT:-10000}
# Scope NODE_ENV=production to the Next.js invocation ONLY, not the whole
# container environment. `ENV NODE_ENV=production` at the image level would
# leak into every child process (agent, shell scripts, healthchecks) — most
# of which don't interpret NODE_ENV the way Next.js does. `env` prefix binds
# the value to this single exec so the agent spawned above keeps the host
# environment intact.
#
# Log prefixing uses bash process substitution (`&> >(awk …)`) rather than a
# pipe (`| sed …`): process substitution leaves `$!` pointing at the real
# Next.js process, so `wait -n $NEXTJS_PID` monitors the right thing.
# `awk` with `fflush()` line-flushes each prefixed line to the container log.
env NODE_ENV=production npx next start --port $PORT &> >(awk '{print "[nextjs] " $0; fflush()}') &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"
echo "[entrypoint] All processes running. Waiting..."

# Only wait on agent + next.js — NOT the watchdog. The watchdog's job is to
# kill the agent when it hangs; if the watchdog exits first (e.g. because it
# killed the agent), wait -n would otherwise return with the watchdog's exit
# code and short-circuit before the agent's true exit status is observable.
wait -n $AGENT_PID $NEXTJS_PID
EXIT_CODE=$?
if ! kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] Agent process (PID: $AGENT_PID) exited with code $EXIT_CODE"
elif ! kill -0 $NEXTJS_PID 2>/dev/null; then
  echo "[entrypoint] Next.js process (PID: $NEXTJS_PID) exited with code $EXIT_CODE"
else
  echo "[entrypoint] A process exited with code $EXIT_CODE"
fi

# Clean up surviving processes (including watchdog)
kill $AGENT_PID $NEXTJS_PID $WATCHDOG_PID 2>/dev/null
exit $EXIT_CODE
