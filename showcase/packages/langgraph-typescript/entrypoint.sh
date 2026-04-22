#!/bin/bash
set -e

cleanup() {
  kill $AGENT_PID $NEXTJS_PID $WATCHDOG_PID 2>/dev/null || true
}
trap cleanup EXIT

echo "========================================="
echo "[entrypoint] Starting showcase package: langgraph-typescript"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

# Start LangGraph agent server in background.
# `npm start` runs `node --import tsx liveness.mjs` (see src/agent/package.json).
# liveness.mjs binds :8124/ok immediately using only node:http, then dynamic-
# imports server.mjs to kick off the real @langchain/langgraph-api bootstrap.
# We avoid `langgraph-cli dev` for the same reasons as before: dev wraps the
# server in `tsx watch` + chokidar + Studio IPC, and its schema-extraction
# worker is cold on first request (multi-second TS program compile).
# Production path:
#   1. `node --import tsx liveness.mjs` — tsx is a one-shot ESM hook so the
#      subsequent dynamic import of server.mjs (and thence graph.ts) resolves
#      without pre-compilation. NOT a watcher.
#   2. liveness.mjs brings up :8124/ok before any heavy import runs.
#   3. Dynamic-imported server.mjs pre-warms the schema cache before the
#      first external /assistants/*/schemas hits.
#
# --host 0.0.0.0 via HOST env; binds IPv4+IPv6 so the Next.js frontend can
# reach the agent regardless of how `localhost` resolves in the container.
#
# Log prefixing uses bash process substitution (`&> >(awk …)`) rather than a
# pipe (`| sed …`): process substitution leaves `$!` pointing at the real
# node process, so `wait -n $AGENT_PID` monitors the right thing.
echo "[entrypoint] Starting LangGraph TS agent on port 8123 (prod mode, no CLI)..."
cd /app/src/agent && PORT=8123 HOST=0.0.0.0 npm start &> >(awk '{print "[agent] " $0; fflush()}') &
AGENT_PID=$!
cd /app
sleep 3
if kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] Agent server started (PID: $AGENT_PID)"
else
  echo "[entrypoint] ERROR: Agent server failed to start — exiting"
  exit 1
fi

echo "========================================="
echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
echo "========================================="

PORT=${PORT:-10000}
# Scope NODE_ENV=production to the Next.js invocation ONLY, not the whole
# container environment. `ENV NODE_ENV=production` at the image level would
# leak into every child process (agent, shell, healthchecks). `env` prefix
# binds the value to this single exec.
env NODE_ENV=production npx next start --port $PORT &> >(awk '{print "[nextjs] " $0; fflush()}') &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"

# Watchdog: Railway deploys of showcase packages have been observed to hit a
# silent agent hang — the langgraph process stays alive (so `wait -n` never
# fires and the container never restarts) but stops responding on :8123.
# Poll the liveness sidecar on :8124/ok every 30s (bound by liveness.mjs
# BEFORE server.mjs is dynamic-imported, so it is up within ms of node boot —
# independent of the multi-minute @langchain/langgraph-api top-level import
# that gates the main Hono bind on :8123). After 3 consecutive failures
# (~90s of unreachable agent), kill the agent process so `wait -n` returns
# and Railway restarts the container. Generalized from
# showcase/packages/crewai-crews/entrypoint.sh (PRs #4114 + #4115).
#
# Startup grace: langgraph-cli dev does a heavy cold-start (Studio IPC +
# @langchain/langgraph-api spawn + graph compile). On fresh Railway
# containers this routinely exceeds the 90s (3-strike) budget introduced
# in PR #4116, producing the 04-20 restart loop seen on deployment
# 58bbebe8-7a94-4f99-b6e4-ffcbb4eb78b9. Wait up to 180s for the first
# healthy /ok probe before arming the strike counter; if /ok comes up
# sooner, fall through immediately. If 180s elapses without success, arm
# the counter anyway — the steady-state watchdog will handle a true hang.
(
  GRACE=180
  echo "[watchdog] Startup grace: waiting up to ${GRACE}s for first successful health probe before arming strike counter"
  ELAPSED=0
  while [ $ELAPSED -lt $GRACE ]; do
    if ! kill -0 $AGENT_PID 2>/dev/null; then
      # Agent died during startup — wait -n in the main shell will handle it.
      exit 0
    fi
    if curl -fsS --max-time 5 http://127.0.0.1:8124/ok > /dev/null 2>&1; then
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
    if curl -fsS --max-time 5 http://127.0.0.1:8124/ok > /dev/null 2>&1; then
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
echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID, probing http://127.0.0.1:8124/ok, startup grace 180s)"
echo "[entrypoint] All processes running. Waiting..."

# Only wait on agent + next.js — NOT the watchdog. The watchdog's job is to
# kill the agent when it hangs; if the watchdog exits first, `wait -n` would
# otherwise return with the watchdog's exit code and short-circuit before
# the agent's true exit status is observable.
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
