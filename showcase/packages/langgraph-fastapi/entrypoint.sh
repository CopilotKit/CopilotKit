#!/bin/bash
set -e

cleanup() {
  kill $AGENT_PID $NEXTJS_PID $WATCHDOG_PID 2>/dev/null || true
}
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

echo "[entrypoint] Starting LangGraph agent server on port 8123..."
# `python -u` + `awk ... fflush()`: unbuffered stdout at the interpreter
# level + line-flushed awk prefixer so tracebacks reach the container log
# immediately rather than block-buffered in pipe buffers.
python -u -m langgraph_cli dev \
  --config langgraph.json \
  --host 0.0.0.0 \
  --port 8123 \
  --no-browser &> >(awk '{print "[agent] " $0; fflush()}') &
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
env NODE_ENV=production npx next start --port $PORT &> >(awk '{print "[nextjs] " $0; fflush()}') &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"

# Watchdog: Railway deploys of showcase packages have been observed to hit a
# silent agent hang — the agent process stays alive (so `wait -n` never
# fires and the container never restarts) but stops responding on :8123.
# Poll the agent's /ok endpoint (langgraph_cli's health path) every 30s;
# after 3 consecutive failures (~90s of unreachable agent), kill the agent
# process so `wait -n` returns and Railway restarts the container.
# Generalized from showcase/packages/crewai-crews/entrypoint.sh (PRs #4114
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
    if curl -fsS --max-time 5 http://127.0.0.1:8123/ok > /dev/null 2>&1; then
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
    if curl -fsS --max-time 5 http://127.0.0.1:8123/ok > /dev/null 2>&1; then
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
