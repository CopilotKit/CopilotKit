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
echo "[entrypoint] Starting showcase package: hermes"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

if [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: OPENAI_API_KEY is not set! Agent will fail."
else
  echo "[entrypoint] OPENAI_API_KEY: set (${#OPENAI_API_KEY} chars)"
fi

# The Hermes AG-UI adapter (vendored under /app/agui_adapter). With
# HERMES_AGUI_BASE_URL set, the adapter bypasses the hermes provider resolver
# and talks to the given OpenAI-compatible endpoint directly (aimock in the D5
# harness) — deterministic, no real provider tokens. api_mode=chat_completions
# matches aimock's /v1/chat/completions surface.
#
# OPENAI_BASE_URL / OPENAI_API_KEY are provided by docker-compose
# (x-integration-defaults). Default them here for standalone runs so the agent
# doesn't crash on import if the compose env is absent.
export HERMES_AGUI_HOST=0.0.0.0
export HERMES_AGUI_PORT=8000
export OPENAI_BASE_URL=${OPENAI_BASE_URL:-http://aimock:4010/v1}
export OPENAI_API_KEY=${OPENAI_API_KEY:-sk-aimock}
export HERMES_AGUI_BASE_URL=${HERMES_AGUI_BASE_URL:-$OPENAI_BASE_URL}
export HERMES_AGUI_API_KEY=${HERMES_AGUI_API_KEY:-$OPENAI_API_KEY}
export HERMES_AGUI_MODEL=${HERMES_AGUI_MODEL:-gpt-5-mini}
export HERMES_AGUI_PROVIDER=${HERMES_AGUI_PROVIDER:-custom}
export HERMES_AGUI_API_MODE=${HERMES_AGUI_API_MODE:-chat_completions}

echo "[entrypoint] HERMES_AGUI_BASE_URL=${HERMES_AGUI_BASE_URL}"
echo "[entrypoint] HERMES_AGUI_MODEL=${HERMES_AGUI_MODEL} PROVIDER=${HERMES_AGUI_PROVIDER} API_MODE=${HERMES_AGUI_API_MODE}"

# Start agent backend on :8000 with log prefixing so its output is
# distinguishable from Next.js in the log stream.
echo "[entrypoint] Starting Python Hermes AG-UI adapter on port 8000..."
python -u -m agui_adapter &> >(awk '{print "[agent] " $0; fflush()}') &
AGENT_PID=$!

# Health-probe the agent's /health before starting Next.js (mirror the
# pydantic-ai entrypoint contract). Give it up to ~30s to import
# hermes-agent + bind the port.
echo "[entrypoint] Waiting for agent /health on :8000..."
AGENT_READY=0
for i in $(seq 1 30); do
  if ! kill -0 $AGENT_PID 2>/dev/null; then
    echo "[entrypoint] ERROR: Agent process died during startup — exiting"
    exit 1
  fi
  if curl -fsS --max-time 3 http://127.0.0.1:8000/health > /dev/null 2>&1; then
    AGENT_READY=1
    echo "[entrypoint] Agent healthy after ~${i}s (PID: $AGENT_PID)"
    break
  fi
  sleep 1
done
if [ "$AGENT_READY" -ne 1 ]; then
  echo "[entrypoint] ERROR: Agent did not become healthy within 30s — exiting"
  exit 1
fi

echo "========================================="
echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
echo "========================================="

PORT=${PORT:-10000}
# Scope NODE_ENV=production to the Next.js invocation ONLY, not the whole
# container environment.
env NODE_ENV=production npx next start --port $PORT &> >(awk '{print "[nextjs] " $0; fflush()}') &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"

# Watchdog: poll the agent's /health every 30s; after 3 consecutive failures
# (~90s unreachable), kill the agent so `wait -n` returns and the container
# restarts.
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
