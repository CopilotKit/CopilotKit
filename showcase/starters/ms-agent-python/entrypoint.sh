#!/bin/bash
# Template variables (substituted by generate-starters.ts):
#   SLUG             — framework slug (e.g. "langgraph-python")
#   DEV_SCRIPT_BLOCK — language-specific agent startup block
set -e

cleanup() {
  kill $AGENT_PID $NEXTJS_PID 2>/dev/null
}
trap cleanup EXIT

# Disable Python stdout buffering so Python-based agents flush tracebacks
# and log lines to awk (and the container log) the moment they're written.
# Previously a silent crash during module import would sit in Python's
# userspace buffer until the process exited, by which point the pipe to the
# log prefixer had already closed and the error was lost.
export PYTHONUNBUFFERED=1

echo "========================================="
echo "[entrypoint] Starting showcase: ms-agent-python"
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
cd /app && python -m uvicorn agent_server:app --host 0.0.0.0 --port 8123 2>&1 | sed 's/^/[agent] /' &
AGENT_PID=$!
sleep 2
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
echo "[entrypoint] Both processes running. Waiting..."

wait -n $AGENT_PID $NEXTJS_PID
EXIT_CODE=$?
if ! kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] Agent process (PID: $AGENT_PID) exited with code $EXIT_CODE"
elif ! kill -0 $NEXTJS_PID 2>/dev/null; then
  echo "[entrypoint] Next.js process (PID: $NEXTJS_PID) exited with code $EXIT_CODE"
else
  echo "[entrypoint] A process exited with code $EXIT_CODE"
fi

# Clean up surviving process
kill $AGENT_PID $NEXTJS_PID 2>/dev/null
exit $EXIT_CODE
