#!/bin/bash
set -e

# Shutdown traps. EXIT alone does NOT cover SIGTERM: an untrapped SIGTERM kills
# bash by signal and the EXIT trap never runs — and SIGTERM is exactly what
# Railway sends on every redeploy/rollover. Without the INT/TERM trap both
# children were orphan-reparented to PID 1 on that path, still holding
# :$AGENT_PORT and $PORT, so the replacement container could not bind. Same
# reasoning, and the same two traps, as
# showcase/integrations/spring-ai/entrypoint.sh and
# showcase/integrations/langgraph-python/entrypoint.sh — those two are the exact
# matches: `trap cleanup EXIT` plus `trap _on_signal INT TERM`, a `_CLEANED`
# idempotence flag, and an unconditional `exit 143` from the signal handler.
#
# Every OTHER entrypoint in showcase/integrations/*/entrypoint.sh — with ONE
# exception, named below — carries the SAME design (a `_CLEANED` flag,
# `trap cleanup EXIT`, and a signal handler that exits instead of falling back
# into the script) but a different SHAPE: it splits the signal trap into
# `trap '_on_signal INT' INT` plus `trap '_on_signal TERM' TERM` so the handler
# can exit 130 on INT and 143 on TERM. Read them as cousins, not as this file's
# twin.
#
# THE EXCEPTION IS built-in-agent, which carries NONE of this apparatus — no
# `_CLEANED`, no trap, no signal handler — and needs none. It is a single
# `exec env NODE_ENV=production npx next start`, so Next.js REPLACES the shell
# rather than running beside it: the platform's SIGTERM goes straight to
# Next.js, there is no shell left to trap it, and there is no second child to
# reap. Do not "fix" it by adding traps.
#
# Of the entrypoints that DO carry the design, four — mastra,
# langgraph-typescript, ms-agent-dotnet and strands-typescript — go further and
# tree-kill through /proc instead of signalling the direct child pids. The rest
# signal the direct child pids as this file does, EXCEPT langroid: it sends
# SIGTERM, polls a 5-second grace loop, and then escalates to `kill -9`.
# spring-ai — one of the two twins named above — escalates as well, through its
# `_terminate_pid` helper: SIGTERM, a 10-second poll, then SIGKILL, then a reap.
# So "one plain SIGTERM and no escalation" describes THIS file and
# langgraph-python, not spring-ai.
#
# Idempotent: _CLEANED makes the second call a no-op, so the signal path
# followed by the EXIT trap kills nothing twice.
#
# LIMITATION, stated honestly (as spring-ai does): cleanup sends ONE plain
# SIGTERM to the DIRECT child pids and does not wait or escalate to SIGKILL.
# NEXTJS_PID is the `env … npx next start` process, which may fork the real
# Next.js `node` server as a child — if npx does not forward the signal, that
# server can survive as an orphan still holding $PORT. mastra,
# langgraph-typescript, ms-agent-dotnet and strands-typescript solve that class
# with a /proc process-tree walk; strands has not adopted it yet.
_CLEANED=0
cleanup() {
  [ "$_CLEANED" = "1" ] && return 0
  _CLEANED=1
  kill $AGENT_PID $NEXTJS_PID $WATCHDOG_PID 2>/dev/null || true
}
_on_signal() {
  echo "[entrypoint] Received shutdown signal — terminating children"
  cleanup
  # 143 = 128 + SIGTERM, the conventional shell exit code for a SIGTERM death.
  exit 143
}
trap cleanup EXIT
trap _on_signal INT TERM

# Disable Python stdout buffering so the FastAPI/uvicorn agent flushes
# tracebacks and log lines immediately. Without this a silent crash during
# module import can sit in Python's userspace buffer until the process
# exits, by which point the container is already gone.
export PYTHONUNBUFFERED=1

echo "========================================="
echo "[entrypoint] Starting showcase package: strands"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

if [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: OPENAI_API_KEY is not set! Agent will fail."
else
  echo "[entrypoint] OPENAI_API_KEY: set (${#OPENAI_API_KEY} chars)"
fi

# Agent listen port. Deliberately AGENT_PORT and NOT PORT: this container still
# runs Next.js on $PORT, and two processes cannot bind the same port — pointing
# the agent at $PORT would collide and break the container. AGENT_PORT is unset
# in every deploy today, so the agent still lands on 8000 and behaviour is
# byte-for-byte unchanged.
#
# AGENT_PORT IS NOT A STANDALONE KNOB. It moves ONLY the agent's listen port.
# Every Next.js route in src/app/api/* reads `process.env.AGENT_URL ||
# "http://localhost:8000"`, so setting AGENT_PORT alone moves the agent away
# from the port the frontend still dials — every demo breaks while this
# entrypoint's watchdog (which follows AGENT_PORT) keeps reporting healthy.
# To change the agent port you MUST set AGENT_URL to match, e.g.
#   AGENT_PORT=9000 AGENT_URL=http://localhost:9000
AGENT_PORT="${AGENT_PORT:-8000}"

# Start agent backend on :$AGENT_PORT with log prefixing so its output is
# distinguishable from Next.js in the Railway log stream.
#
# Belt-and-suspenders log flushing: `PYTHONUNBUFFERED=1` above exports the env
# var, but a child process could in principle un-export or override it. The
# `-u` flag to the Python interpreter forces unbuffered stdout/stderr at the
# interpreter level and is not overridable by user code. Combined with the
# `while read` log prefixer below, this guarantees uvicorn request lines
# and tracebacks reach Railway's log stream line-at-a-time rather than
# block-buffered in pipe buffers.
#
# That prefixer is a bash `while read`/`printf` loop and NOT `awk`: the images
# ship mawk, which block-buffers its INPUT, so `fflush()` never fired for a
# long-lived child and its lines never reached `docker logs` at all. Full
# explanation in showcase/integrations/mastra/entrypoint.sh — do not go back
# to awk.
echo "[entrypoint] Starting Python agent on port ${AGENT_PORT}..."
python -u -m uvicorn agent_server:app --host 0.0.0.0 --port "$AGENT_PORT" &> >(while IFS= read -r line; do printf '[agent] %s\n' "$line"; done) &
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
env NODE_ENV=production npx next start --port $PORT &> >(while IFS= read -r line; do printf '[nextjs] %s\n' "$line"; done) &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"

# Watchdog: Railway deploys of showcase packages have been observed to hit a
# silent agent hang — the Python process stays alive (so `wait -n` never
# fires and the container never restarts) but stops responding on :$AGENT_PORT.
# Poll the agent's /health endpoint every 30s; after 3 consecutive failures
# (at least ~90s of unreachable agent — each failed probe can additionally burn
# up to the `curl --max-time 5` timeout, so 3 strikes is 90s PLUS up to 5s per
# strike, never less than 90s), kill the agent process so `wait -n` returns
# and Railway restarts the container. We kill the agent (not the whole
# script) first so the restart runs through the normal `wait -n` path rather
# than a forced `exit` that would bypass logging. That only holds because the
# wait below is guarded with `|| EXIT_CODE=$?` — see the LOAD-BEARING comment
# there. Generalized from showcase/integrations/crewai-crews/entrypoint.sh
# (PRs #4114 + #4115).
(
  FAILS=0
  while sleep 30; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      # Agent already dead — wait -n in the main shell will handle it.
      break
    fi
    if curl -fsS --max-time 5 "http://127.0.0.1:${AGENT_PORT}/health" > /dev/null 2>&1; then
      FAILS=0
    else
      FAILS=$((FAILS + 1))
      echo "[watchdog] Agent health probe failed (count=$FAILS)"
      if [ $FAILS -ge 3 ]; then
        echo "[watchdog] Agent unresponsive for at least ~90s (plus up to 5s per failed probe) — killing PID $AGENT_PID to trigger container restart"
        kill -9 $AGENT_PID 2>/dev/null || true
        break
      fi
    fi
  done
) &
WATCHDOG_PID=$!

echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID)"
echo "[entrypoint] All processes running. Waiting..."

# Only wait on agent + next.js — NOT the watchdog. The watchdog's job is to
# kill the agent when it hangs; if the watchdog exits first, an arg-less
# `wait -n` would return the WATCHDOG's status (0) and the container would
# exit 0 on an agent crash.
#
# `|| EXIT_CODE=$?` is LOAD-BEARING under `set -e`: the PRIMARY designed exit
# path here is a NON-ZERO wait (137 = the watchdog's `kill -9` of the agent, or
# an agent crash). Without the `||` guard, `set -e` aborts the script AT this
# line on exactly those interesting exits, making the entire "which process
# exited with code N" diagnostic below AND the final explicit `exit $EXIT_CODE`
# dead code.
#
# REAPED_PID via `wait -n -p VAR` (bash >= 5.1; the python:3.12-slim runner
# ships 5.2) captures the ACTUAL PID `wait -n` reaped, so the diagnostic names
# the correct process even when both die near-simultaneously. A `kill -0` probe
# AFTER the wait only INFERS it, and mislabels when both are already dead.
REAPED_PID=""
EXIT_CODE=0
wait -n -p REAPED_PID "$AGENT_PID" "$NEXTJS_PID" || EXIT_CODE=$?
if [ "$REAPED_PID" = "$AGENT_PID" ]; then
  echo "[entrypoint] Agent (PID: $AGENT_PID) exited with code $EXIT_CODE"
elif [ "$REAPED_PID" = "$NEXTJS_PID" ]; then
  echo "[entrypoint] Next.js (PID: $NEXTJS_PID) exited with code $EXIT_CODE"
else
  echo "[entrypoint] A process (PID: ${REAPED_PID:-unknown}) exited with code $EXIT_CODE"
fi

exit $EXIT_CODE
