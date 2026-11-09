#!/bin/sh
# Starts the Antigravity agent, waits for it, then starts Next.js. If either
# process exits, the container exits, so Cloud Run restarts it.
set -eu

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "GEMINI_API_KEY is not set. Every model call would fail, so not starting." >&2
  exit 1
fi

mkdir -p "$WORKSPACE_ROOT" "$SAVE_DIR" "$PUSH_ROOT"

# Each process starts without the other's secret.
cd /app/agent
env -u CPK_INTELLIGENCE_API_KEY .venv/bin/repo-doctor-agent &
agent_pid=$!

# The harness binary starts lazily; the server itself is up within seconds.
healthy=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${AGENT_PORT:-8000}/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  if ! kill -0 "$agent_pid" 2>/dev/null; then
    echo "The agent exited during startup." >&2
    exit 1
  fi
  sleep 0.5
done
if [ "$healthy" -ne 1 ]; then
  echo "The agent did not answer /health within 30 seconds." >&2
  kill "$agent_pid" 2>/dev/null || true
  exit 1
fi

cd /app/web
env -u GEMINI_API_KEY HOSTNAME=0.0.0.0 node server.js &
web_pid=$!

# Exit as soon as either process does (POSIX sh has no `wait -n`).
while kill -0 "$agent_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do
  sleep 2
done
kill "$agent_pid" "$web_pid" 2>/dev/null || true
exit 1
