#!/bin/bash
set -e

# Shutdown traps. EXIT alone does NOT cover SIGTERM: an untrapped SIGTERM kills
# bash BY SIGNAL and bash never runs the EXIT trap — and SIGTERM is exactly what
# Railway sends on every redeploy/rollover, and what `docker stop` sends. With
# an EXIT-only trap the children were orphan-reparented to PID 1 on that path,
# still holding :$AGENT_PORT and $PORT, so the replacement container could not
# bind.
#
# SEPARATE SIGNAL AND EXIT TRAPS, matching mastra, langgraph-typescript,
# ms-agent-dotnet and strands-typescript: splitting INT from TERM lets the
# handler report 130 vs 143 instead of a flat 143. Those four differ only in
# HOW they kill — they walk /proc, because a bare kill reaps only the wrapper
# and orphans the real server underneath it. This file keeps its plain kill of
# the direct child pids, and that is a KNOWN remaining gap rather than a design
# choice: NEXTJS_PID is an `npx next start` wrapper that can fork the real
# Next.js server, which would then survive as an orphan holding $PORT. Adopting
# the /proc walk here is a separate, larger change. spring-ai, strands and
# langgraph-python carry the same idea in a shorter shape (one
# `trap _on_signal INT TERM`, unconditional 143) and state the same limitation.
#
# Handling the signal and exiting INSIDE the handler also keeps the `wait -n`
# diagnostic below truthful: a fall-through signal INTERRUPTS the wait instead
# of reaping a child, so the diagnostic would report a phantom exit on every
# ordinary redeploy.
#
# _CLEANED makes cleanup idempotent. Without it a SIGTERM runs cleanup once for
# the TERM trap, and bash then runs it AGAIN for the EXIT trap.
_CLEANED=0
cleanup() {
  if [ "$_CLEANED" = "1" ]; then
    return 0
  fi
  _CLEANED=1
  kill $AGENT_PID $NEXTJS_PID $WATCHDOG_PID 2>/dev/null || true
  # Explicit success: a cleanup that reports failure purely because it had
  # nothing to kill is a trap waiting for the next edit under `set -e`.
  return 0
}
_on_signal() {
  echo "[entrypoint] Received shutdown signal — terminating children"
  cleanup
  # 128 + signal number, the shell convention, so the container's exit status
  # still says WHICH signal stopped it. `docker stop` sends TERM, so 143.
  case "$1" in
    INT) exit 130 ;;
    *) exit 143 ;;
  esac
}
trap '_on_signal INT' INT
trap '_on_signal TERM' TERM
trap cleanup EXIT

# Disable Python stdout buffering so langgraph_cli's dev server and any
# tracebacks it emits reach the Railway log stream immediately rather than
# sitting in Python's userspace buffer until the process exits.
export PYTHONUNBUFFERED=1

echo "========================================="
echo "[entrypoint] Starting showcase package: langgraph-fastapi"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "========================================="

if [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: OPENAI_API_KEY is not set! Agent will fail."
else
  echo "[entrypoint] OPENAI_API_KEY: set (${#OPENAI_API_KEY} chars)"
fi

# Agent listen port. Deliberately AGENT_PORT and NOT PORT: this container still
# runs Next.js on $PORT, and two processes cannot bind the same port — pointing
# the agent at $PORT would collide and break the container. The fallback is
# 8123 (NOT 8000) because that is the port this integration listens on today;
# AGENT_PORT is unset in every deploy, so behaviour is byte-for-byte unchanged.
# It exists so the agent's port becomes a knob for the later single-process
# layout without another edit here.
#
# AGENT_PORT IS NOT A STANDALONE KNOB. It moves ONLY the agent's listen port.
# Fourteen routes under src/app/api/ dial the agent, and THIRTEEN of them
# resolve its URL as `process.env.AGENT_URL || "http://localhost:8123"` (six of
# those — agent-config, declarative-hashbrown, declarative-json-render, ogui,
# voice and debug — try `process.env.LANGGRAPH_DEPLOYMENT_URL` in between). So
# setting AGENT_PORT alone moves the agent away from the port the frontend still
# dials — every demo breaks while this entrypoint's watchdog (which follows
# AGENT_PORT) keeps reporting healthy.
#
# THE FOURTEENTH ROUTE IS THE EXCEPTION, and AGENT_URL does NOT reach it:
# src/app/api/copilotkit-beautiful-chat/route.ts reads ONLY
# `process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123"`. An operator
# who sets AGENT_URL alone therefore moves thirteen routes to the new port and
# leaves beautiful-chat dialling :8123 — one dead cell, with the watchdog still
# green because it follows AGENT_PORT, which is the hardest shape of this bug to
# diagnose.
#
# To change the agent port you MUST set BOTH URL vars to match, e.g.
#   AGENT_PORT=9000 AGENT_URL=http://localhost:9000 \
#     LANGGRAPH_DEPLOYMENT_URL=http://localhost:9000
# Setting LANGGRAPH_DEPLOYMENT_URL as well is harmless for the thirteen routes
# that prefer AGENT_URL: it is only ever consulted when AGENT_URL is unset.
AGENT_PORT="${AGENT_PORT:-8123}"

echo "[entrypoint] Starting LangGraph agent server on port ${AGENT_PORT}..."
# Disable langgraph_runtime_inmem's pickle-flush-to-disk loop. Without this,
# the inmem runtime periodically flushes unbounded thread/checkpoint state to
# .langgraph_api/*.pckl files, which is a slow-burn OOM risk on Railway.
# The env var is checked at import time in langgraph_runtime_inmem
# _persistence.py and checkpoint.py (langgraph-api==0.7.101 / runtime==0.27.4).
export LANGGRAPH_DISABLE_FILE_PERSISTENCE=true

# `python -u` + the `while read` log prefixer: unbuffered stdout at the
# interpreter level + a line-at-a-time prefixer so tracebacks reach the
# container log immediately rather than block-buffered in pipe buffers.
# The prefixer is a bash `while read`/`printf` loop and NOT `awk`: the images
# ship mawk, which block-buffers its INPUT, so `fflush()` never fired for a
# long-lived child and its lines never reached `docker logs` at all. Full
# explanation in showcase/integrations/mastra/entrypoint.sh — do not go back
# to awk.
# `--no-reload` disables watchfiles hot-reload, which fires on every request
# and causes "1 change detected" log spam → Railway 500-logs/sec kill.
python -u -m langgraph_cli dev \
  --config langgraph.json \
  --host 0.0.0.0 \
  --port "$AGENT_PORT" \
  --no-browser \
  --no-reload &> >(while IFS= read -r line; do printf '[agent] %s\n' "$line"; done) &
AGENT_PID=$!

sleep 3

if kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] LangGraph agent started (PID: $AGENT_PID)"
else
  echo "[entrypoint] ERROR: LangGraph agent failed to start — exiting"
  exit 1
fi

echo "========================================="
echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
echo "========================================="

PORT=${PORT:-10000}
env NODE_ENV=production npx next start --port $PORT &> >(while IFS= read -r line; do printf '[nextjs] %s\n' "$line"; done) &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"

# Watchdog: Railway deploys of showcase packages have been observed to hit a
# silent agent hang — the agent process stays alive (so `wait -n` never
# fires and the container never restarts) but stops responding on :$AGENT_PORT.
# Poll the agent's /ok endpoint (langgraph_cli's health path) every 30s;
# after 3 consecutive failures (~90s of unreachable agent), kill the agent
# process so `wait -n` returns and Railway restarts the container.
# Generalized from showcase/integrations/crewai-crews/entrypoint.sh (PRs #4114
# + #4115).
#
# Startup grace: langgraph_cli dev does a heavy cold-start (graph compile
# + uvicorn boot). On fresh Railway containers this can exceed the 90s
# (3-strike) budget introduced in PR #4116, matching the restart loop
# observed on langgraph-typescript (deployment
# 58bbebe8-7a94-4f99-b6e4-ffcbb4eb78b9, 04-20 17:05 UTC). Wait up to 180s
# for the first healthy /ok probe before arming the strike counter; if
# /ok comes up sooner, fall through immediately. If 180s elapses without
# success, arm the counter anyway — the steady-state watchdog will then
# handle a true hang.
(
  GRACE=180
  echo "[watchdog] Startup grace: waiting up to ${GRACE}s for first successful health probe before arming strike counter"
  ELAPSED=0
  while [ $ELAPSED -lt $GRACE ]; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      # Agent died during startup — wait -n in the main shell will handle it.
      exit 0
    fi
    if curl -fsS --max-time 5 "http://127.0.0.1:${AGENT_PORT}/ok" > /dev/null 2>&1; then
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
  while sleep 30; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      break
    fi
    if curl -fsS --max-time 5 "http://127.0.0.1:${AGENT_PORT}/ok" > /dev/null 2>&1; then
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

echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID, startup grace 180s)"
echo "[entrypoint] Agent PID=$AGENT_PID, Next PID=$NEXTJS_PID"
# `|| EXIT_CODE=$?` is LOAD-BEARING under `set -e`: the PRIMARY designed exit
# path here is a NON-ZERO wait (137 = the watchdog's `kill -9` of the agent, or
# an agent crash). Without the `||` guard, `set -e` aborts the script AT this
# line on exactly those interesting exits, so EXIT_CODE is never assigned and
# the "which process exited with code N" diagnostic below — plus the final
# explicit `exit $EXIT_CODE` — is dead code.
EXIT_CODE=0
wait -n $AGENT_PID $NEXTJS_PID || EXIT_CODE=$?
if ! kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] Agent (PID: $AGENT_PID) exited with code $EXIT_CODE"
elif ! kill -0 $NEXTJS_PID 2>/dev/null; then
  echo "[entrypoint] Next.js (PID: $NEXTJS_PID) exited with code $EXIT_CODE"
else
  echo "[entrypoint] A process exited with code $EXIT_CODE"
fi
exit $EXIT_CODE
