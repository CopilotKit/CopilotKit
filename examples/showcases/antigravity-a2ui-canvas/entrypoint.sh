#!/bin/bash
set -e

echo "[entrypoint] A2UI canvas: Next.js on ${PORT:-3000}, agent on 8000"

# Unbuffered Python, so a crash during import reaches the log right away.
export PYTHONUNBUFFERED=1

# Every model call goes to Gemini, and the harness will not start a
# conversation without a key. Fail at boot rather than on the first message.
if [ -z "$GEMINI_API_KEY" ]; then
  echo "[entrypoint] FATAL: GEMINI_API_KEY is not set. Refusing to start." >&2
  exit 1
fi

export ANTIGRAVITY_WORKSPACE="${ANTIGRAVITY_WORKSPACE:-/data/ws}"
export ANTIGRAVITY_SAVE_DIR="${ANTIGRAVITY_SAVE_DIR:-/data/sessions}"
export AGENT_URL="${AGENT_URL:-http://localhost:8000/}"

# The agent gets its own port; Railway's PORT belongs to Next.js.
cd /app/agent
PORT=8000 uv run --frozen python main.py 2>&1 | sed 's/^/[agent] /' &
AGENT_PID=$!
cd /app

# Wait for the agent to answer /health before taking traffic.
for _ in $(seq 1 60); do
  if curl -fsS http://localhost:8000/health >/dev/null 2>&1; then
    echo "[entrypoint] Agent is up"
    break
  fi
  if ! kill -0 "$AGENT_PID" 2>/dev/null; then
    echo "[entrypoint] ERROR: the agent exited during startup" >&2
    exit 1
  fi
  sleep 1
done

export PORT="${PORT:-3000}"
npx next start --hostname 0.0.0.0 --port "$PORT" 2>&1 | sed 's/^/[nextjs] /' &
NEXTJS_PID=$!

# If either process stops, stop the other and exit, so Railway restarts both.
wait -n "$AGENT_PID" "$NEXTJS_PID"
EXIT_CODE=$?
echo "[entrypoint] A process exited with code $EXIT_CODE"
kill "$AGENT_PID" "$NEXTJS_PID" 2>/dev/null || true
exit "$EXIT_CODE"
