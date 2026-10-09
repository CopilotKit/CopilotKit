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

# Agent listen port. Deliberately AGENT_PORT and NOT PORT: this container still
# runs Next.js on $PORT, and two processes cannot bind the same port — pointing
# the agent at $PORT would collide and break the container. AGENT_PORT is unset
# in every deploy today, so the agent still lands on 8000 and behaviour is
# byte-for-byte unchanged. It exists so the agent's port becomes a knob for the
# later single-process layout without another edit here.
#
# agent_server.ts reads `process.env.AGENT_PORT` itself (same 8000 default), so
# no flag is passed to node — this local resolves the SAME value for the
# watchdog probes below, keeping the two in lockstep.
#
# AGENT_PORT IS NOT A STANDALONE KNOB. It moves ONLY the agent's listen port.
# Every Next.js route in src/app/api/* reads `process.env.AGENT_URL ||
# "http://localhost:8000"`, so setting AGENT_PORT alone moves the agent away
# from the port the frontend still dials — every demo breaks while this
# entrypoint's watchdog (which follows AGENT_PORT) keeps reporting healthy.
# To change the agent port you MUST set AGENT_URL to match, e.g.
#   AGENT_PORT=9000 AGENT_URL=http://localhost:9000
AGENT_PORT="${AGENT_PORT:-8000}"

# Start Claude agent backend (TypeScript, compiled to JS).
# Log prefixing uses bash process substitution (`&> >(while read …)`) rather
# than a pipe (`| sed …`): process substitution leaves `$!` pointing at the real
# node process, so `wait -n $AGENT_PID` monitors the right thing.
# The prefixer is a bash `while read`/`printf` loop and NOT `awk`: the images
# ship mawk, which block-buffers its INPUT, so `fflush()` never fired for a
# long-lived child and its lines never reached `docker logs` at all. Full
# explanation in showcase/integrations/mastra/entrypoint.sh — do not go back
# to awk.
echo "[entrypoint] Starting Claude agent on port ${AGENT_PORT}..."
# Instrumentation: package-claude-sdk-typescript health probes fail on
# Railway but process claims to listen — narrow the cold-start window by
# logging immediately before node exec so we can compare against the
# agent_server.ts module-loaded / pre-Anthropic / listening prints below.
echo "[entrypoint] pre-node $(date -u +%Y-%m-%dT%H:%M:%SZ)"
node /app/agent_server.js &> >(while IFS= read -r line; do printf '[agent] %s\n' "$line"; done) &
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
env NODE_ENV=production npx next start --port $PORT &> >(while IFS= read -r line; do printf '[nextjs] %s\n' "$line"; done) &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"

# Watchdog: Railway deploys of showcase packages have been observed to hit a
# silent agent hang — the agent process stays alive (so `wait -n` never
# fires and the container never restarts) but stops responding on :$AGENT_PORT.
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
    if curl -fsS --max-time 5 "http://127.0.0.1:${AGENT_PORT}/health" > /dev/null 2>&1; then
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
