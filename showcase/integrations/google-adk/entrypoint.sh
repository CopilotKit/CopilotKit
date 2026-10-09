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

# Disable Python stdout buffering so the FastAPI/uvicorn agent flushes
# tracebacks and log lines immediately. Without this a silent crash during
# module import can sit in Python's userspace buffer until the process
# exits, by which point the container is already gone.
export PYTHONUNBUFFERED=1

# NOTE: ADK_DISABLE_PROGRESSIVE_SSE_STREAMING was previously exported here to
# dodge an intermittent "The last event is partial" abort on the tool-rendering
# demos. But disabling progressive streaming ALSO suppresses ADK's
# post-backend-tool LLM re-invocation: after a backend function tool (or a
# sub-agent delegation) returns, ADK's non-progressive aggregation path ends the
# agentic loop instead of re-invoking the model with the tool result appended.
# That broke every demo that needs a second turn after a tool result — the
# subagents chain (research -> writing -> critique), tool-rendering-reasoning-chain
# (AAPL -> MSFT), shared-state-read-write's confirmation, the custom-catchall
# narration, and headless-complete's per-turn completion. The partial-event
# abort it guarded against is already handled in-callback by `stop_on_terminal_text`
# (shared by every registered agent), so progressive streaming is left ON.
# (Do not re-add this flag without a per-agent feature override that keeps
# progressive streaming ON for the backend-tool / sub-agent chain agents.)

echo "========================================="
echo "[entrypoint] Starting showcase package: google-adk"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

# Warn (default) or fail-fast when GOOGLE_API_KEY is missing. This package is
# Gemini end-to-end: the primary LlmAgent uses Gemini, and the secondary
# generate_a2ui planner call also uses google.genai. Without the key, every
# tool call in the container will fail. Default behavior is warn-and-continue
# so operators can still bring the container up for inspection / smoke
# testing; generate_a2ui itself returns a structured `a2ui_llm_error` dict at
# request time when the key is missing, so callers see a clean error surface.
#
# For production deployments that MUST have the key, set
# `REQUIRE_GOOGLE_API_KEY=1` to escalate to fail-fast: the entrypoint exits
# non-zero immediately instead of surfacing the problem lazily at request
# time. Railway / compose overrides should set this in prod environments.
if [ -z "${GOOGLE_API_KEY:-}" ]; then
    if [ "${REQUIRE_GOOGLE_API_KEY:-0}" = "1" ]; then
        echo "[entrypoint] FATAL: GOOGLE_API_KEY not set and REQUIRE_GOOGLE_API_KEY=1 — refusing to start" >&2
        exit 1
    fi
    echo "[entrypoint] WARN: GOOGLE_API_KEY not set — all Gemini-backed tools (chat + generate_a2ui) will return structured errors at request time" >&2
fi

# Agent listen port. Deliberately AGENT_PORT and NOT PORT: this container still
# runs Next.js on $PORT, and two processes cannot bind the same port — pointing
# the agent at $PORT would collide and break the container. AGENT_PORT is unset
# in every deploy today, so the agent still lands on 8000 and behaviour is
# byte-for-byte unchanged. It exists so the agent's port becomes a knob for the
# later single-process layout without another edit here.
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
# var, but the `-u` flag to the Python interpreter forces unbuffered
# stdout/stderr at the interpreter level and is not overridable by user code.
# Combined with the `while read` log prefixer below, uvicorn request lines
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
# (90s of unreachable agent), kill the agent process so `wait -n` returns
# and Railway restarts the container. Generalized from
# showcase/integrations/crewai-crews/entrypoint.sh (PRs #4114 + #4115).
(
  FAILS=0
  while sleep 30; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      break
    fi
    if curl -fsS --max-time 5 "http://127.0.0.1:${AGENT_PORT}/health" > /dev/null 2>&1; then
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
