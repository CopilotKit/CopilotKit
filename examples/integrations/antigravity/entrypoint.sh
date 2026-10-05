#!/bin/bash
set -e

echo "========================================="
echo "[entrypoint] Starting: Google Antigravity starter"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "========================================="

# Unbuffered Python so a crash during import reaches the log immediately
# instead of sitting in a userspace buffer until the process is gone.
export PYTHONUNBUFFERED=1

# Fail fast rather than warn: every model call goes to Gemini, and the Go
# harness will not create a conversation without GEMINI_API_KEY — even when
# GOOGLE_GEMINI_BASE_URL points it at a mock. Without the key the agent starts
# and answers /health, but every chat turn fails.
if [ -z "$GEMINI_API_KEY" ]; then
  echo "[entrypoint] FATAL: GEMINI_API_KEY is not set, so every model call would fail. Refusing to start." >&2
  exit 1
fi

# The harness sandbox and trajectory store. Created in the Dockerfile; keep the
# workspace path SHORT (a long one makes the model mangle it in tool calls).
export ANTIGRAVITY_WORKSPACE="${ANTIGRAVITY_WORKSPACE:-/data/ws}"
export ANTIGRAVITY_SAVE_DIR="${ANTIGRAVITY_SAVE_DIR:-/data/sessions}"

# Start Python agent on port 8000 (override PORT which Railway sets to 3000)
echo "[entrypoint] Starting Antigravity agent on port 8000..."
cd /app/agent
PORT=8000 uv run python main.py 2>&1 | sed 's/^/[agent] /' &
AGENT_PID=$!
cd /app

sleep 2

if kill -0 $AGENT_PID 2>/dev/null; then
  echo "[entrypoint] Antigravity agent started (PID: $AGENT_PID)"
else
  echo "[entrypoint] ERROR: Antigravity agent failed to start!"
fi

# Start Next.js frontend
echo "[entrypoint] Starting Next.js on port ${PORT:-3000}..."
export PORT="${PORT:-3000}"
npx next start --port "$PORT" 2>&1 | sed 's/^/[nextjs] /' &
NEXTJS_PID=$!

echo "[entrypoint] Both processes running. Waiting..."

wait -n $AGENT_PID $NEXTJS_PID
EXIT_CODE=$?
echo "[entrypoint] A process exited with code $EXIT_CODE"
kill $AGENT_PID $NEXTJS_PID 2>/dev/null || true
exit $EXIT_CODE
