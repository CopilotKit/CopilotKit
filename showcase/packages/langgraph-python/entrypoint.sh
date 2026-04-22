#!/bin/bash
set -e

cleanup() {
  kill $LANGGRAPH_PID $NEXTJS_PID $WATCHDOG_PID 2>/dev/null || true
}
trap cleanup EXIT

# Disable Python stdout buffering so langgraph_cli's dev server and any
# tracebacks it emits reach the Railway log stream immediately rather than
# sitting in Python's userspace buffer until the process exits. Paired with
# `python -u` on the langgraph_cli invocation below.
export PYTHONUNBUFFERED=1

echo "========================================="
echo "[entrypoint] Starting showcase: langgraph-python"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PWD: $(pwd)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

# Check critical env vars
echo "[entrypoint] Checking environment variables..."
if [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: OPENAI_API_KEY is not set! Agent will fail."
else
  echo "[entrypoint] OPENAI_API_KEY: set (${#OPENAI_API_KEY} chars)"
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "[entrypoint] INFO: ANTHROPIC_API_KEY is not set"
else
  echo "[entrypoint] ANTHROPIC_API_KEY: set (${#ANTHROPIC_API_KEY} chars)"
fi

if [ -z "$LANGSMITH_API_KEY" ]; then
  echo "[entrypoint] INFO: LANGSMITH_API_KEY is not set (tracing disabled)"
else
  echo "[entrypoint] LANGSMITH_API_KEY: set (${#LANGSMITH_API_KEY} chars)"
fi

# Verify files exist
echo "[entrypoint] Checking files..."
ls -la langgraph.json 2>/dev/null && echo "[entrypoint] langgraph.json: OK" || echo "[entrypoint] ERROR: langgraph.json missing!"
ls -la src/agents/main.py 2>/dev/null && echo "[entrypoint] src/agents/main.py: OK" || echo "[entrypoint] ERROR: src/agents/main.py missing!"
ls -la src/agents/tools.py 2>/dev/null && echo "[entrypoint] src/agents/tools.py: OK" || echo "[entrypoint] ERROR: src/agents/tools.py missing!"
ls -la .next/server 2>/dev/null > /dev/null && echo "[entrypoint] .next/server: OK" || echo "[entrypoint] ERROR: .next build missing!"

echo "[entrypoint] langgraph.json contents:"
cat langgraph.json

echo "========================================="
echo "[entrypoint] Starting LangGraph agent server on port 8123..."
echo "========================================="

# `python -u` forces unbuffered stdout/stderr at the interpreter level
# (belt-and-suspenders with PYTHONUNBUFFERED=1 above) so langgraph_cli boot
# failures surface in the Railway log stream immediately rather than sitting
# in a pipe buffer until the process exits. `awk ... fflush()` replaces the
# previous `sed` formulation — process substitution leaves $! pointing at
# the real python process (pipe form made $! point at sed).
python -u -m langgraph_cli dev \
  --config langgraph.json \
  --host 0.0.0.0 \
  --port 8123 \
  --no-browser &> >(awk '{print "[langgraph] " $0; fflush()}') &
LANGGRAPH_PID=$!

# Give langgraph a moment to start
sleep 3

# Check if langgraph is still running
if kill -0 $LANGGRAPH_PID 2>/dev/null; then
  echo "[entrypoint] LangGraph agent server started (PID: $LANGGRAPH_PID)"
else
  echo "[entrypoint] ERROR: LangGraph agent server failed to start!"
  echo "[entrypoint] Continuing with Next.js only (demos will show agent errors)"
fi

echo "========================================="
echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
echo "========================================="

PORT=${PORT:-10000}
# Scope NODE_ENV=production to the Next.js invocation ONLY, not the whole
# container environment. `ENV NODE_ENV=production` at the image level would
# leak into the Python langgraph process and any shell subprocesses; scope
# it here so non-Next children see the host's environment.
env NODE_ENV=production npx next start --port $PORT &> >(awk '{print "[nextjs] " $0; fflush()}') &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"

# Watchdog: Railway deploys of showcase packages have been observed to hit a
# silent agent hang — the langgraph process stays alive (so `wait -n` never
# fires and the container never restarts) but stops responding on :8123.
# Poll the langgraph_cli /ok endpoint every 30s; after 3 consecutive failures
# (~90s of unreachable agent), kill the agent process so `wait -n` returns
# and Railway restarts the container. Generalized from
# showcase/packages/crewai-crews/entrypoint.sh (PRs #4114 + #4115).
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
    if ! kill -0 $LANGGRAPH_PID 2>/dev/null; then
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
    if ! kill -0 $LANGGRAPH_PID 2>/dev/null; then
      break
    fi
    if curl -fsS --max-time 5 http://127.0.0.1:8123/ok > /dev/null 2>&1; then
      FAILS=0
    else
      FAILS=$((FAILS + 1))
      echo "[watchdog] Agent health probe failed (count=$FAILS)"
      if [ $FAILS -ge 3 ]; then
        echo "[watchdog] Agent unresponsive for ~90s — killing PID $LANGGRAPH_PID to trigger container restart"
        kill -9 $LANGGRAPH_PID 2>/dev/null || true
        break
      fi
    fi
  done
) &
WATCHDOG_PID=$!
echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID, probing http://127.0.0.1:8123/ok, startup grace 180s)"
echo "[entrypoint] All processes running. Waiting..."

# Only wait on agent + next.js — NOT the watchdog. The watchdog's job is to
# kill the agent when it hangs; if the watchdog exits first (e.g. because it
# killed the agent), wait -n would otherwise return with the watchdog's exit
# code and short-circuit before the agent's true exit status is observable.
wait -n $LANGGRAPH_PID $NEXTJS_PID
EXIT_CODE=$?
if ! kill -0 $LANGGRAPH_PID 2>/dev/null; then
  echo "[entrypoint] LangGraph (PID: $LANGGRAPH_PID) exited with code $EXIT_CODE"
elif ! kill -0 $NEXTJS_PID 2>/dev/null; then
  echo "[entrypoint] Next.js (PID: $NEXTJS_PID) exited with code $EXIT_CODE"
else
  echo "[entrypoint] A process exited with code $EXIT_CODE"
fi
exit $EXIT_CODE
