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

echo "========================================="
echo "[entrypoint] Starting showcase package: google-antigravity"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

# Warn (default) or fail-fast when OPENAI_API_KEY is missing. Every model call
# in this package goes through the in-process OpenAI-compatible shim
# (src/openai_proxy.py), which is the piece that attaches
# `Authorization: Bearer $OPENAI_API_KEY` — the Go harness has no API-key field
# of its own. Without the key the shim refuses to start, so the first run of
# any agent fails. Default behavior is warn-and-continue so operators can still
# bring the container up for inspection / smoke testing (the frontend, /health
# and the demo pages all come up fine); compose supplies `sk-mock` for the
# aimock replay path.
#
# For deployments that MUST have the key, set `REQUIRE_OPENAI_API_KEY=1` to
# escalate to fail-fast: the entrypoint exits non-zero immediately instead of
# surfacing the problem lazily at request time.
if [ -z "${OPENAI_API_KEY:-}" ]; then
    if [ "${REQUIRE_OPENAI_API_KEY:-0}" = "1" ]; then
        echo "[entrypoint] FATAL: OPENAI_API_KEY not set and REQUIRE_OPENAI_API_KEY=1 — refusing to start" >&2
        exit 1
    fi
    echo "[entrypoint] WARN: OPENAI_API_KEY not set — the OpenAI shim cannot start, so every agent run will fail at request time" >&2
fi

# Antigravity's Go harness does real file and shell work inside a workspace and
# writes trajectories to a save_dir. Both are created in the Dockerfile and
# owned by the unprivileged `app` user; keep the paths SHORT (a long,
# high-entropy workspace path makes the model reproduce it wrongly in tool
# calls and the run dies mid-call).
export ANTIGRAVITY_WORKSPACE="${ANTIGRAVITY_WORKSPACE:-/data/ws}"
export ANTIGRAVITY_SAVE_DIR="${ANTIGRAVITY_SAVE_DIR:-/data/sessions}"

# Start agent backend on :8000 with log prefixing so its output is
# distinguishable from Next.js in the Railway log stream.
#
# Belt-and-suspenders log flushing: `PYTHONUNBUFFERED=1` above exports the env
# var, but the `-u` flag to the Python interpreter forces unbuffered
# stdout/stderr at the interpreter level and is not overridable by user code.
# Combined with `fflush()` inside the awk pipe below, uvicorn request lines
# and tracebacks reach Railway's log stream line-at-a-time rather than
# block-buffered in pipe buffers.
echo "[entrypoint] Starting Python agent on port 8000..."
python -u -m uvicorn agent_server:app --host 0.0.0.0 --port 8000 &> >(awk '{print "[agent] " $0; fflush()}') &
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
# and Railway restarts the container. Generalized from
# showcase/integrations/crewai-crews/entrypoint.sh (PRs #4114 + #4115).
(
  FAILS=0
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
