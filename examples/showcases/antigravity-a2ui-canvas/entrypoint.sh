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
AGENT_STARTUP_SECONDS="${AGENT_STARTUP_SECONDS:-60}"

AGENT_PID=
NEXTJS_PID=

# Stops whichever service is still running and waits for it to go.
stop_services() {
  kill $AGENT_PID $NEXTJS_PID 2>/dev/null || true
  wait $AGENT_PID $NEXTJS_PID 2>/dev/null || true
}
trap 'stop_services; exit 143' TERM INT

# Each service writes through a log prefixer in a process substitution rather
# than a pipe, so $! is the service itself and its exit code is what `wait`
# reports. Behind a pipe, $! would be sed, which exits 0 when the service
# crashes.
#
# The agent gets its own port; Railway's PORT belongs to Next.js.
cd /app/agent
PORT=8000 uv run --frozen python main.py > >(sed -u 's/^/[agent] /') 2>&1 &
AGENT_PID=$!
cd /app

# Take traffic only once the agent answers /health. Next.js's own health route
# does not ask the agent, so starting it early would put a demo that cannot run
# a prompt behind a passing health check.
#
# The deadline is in seconds, not attempts, and each probe has a timeout that
# fits in what is left: an agent that accepts the connection but never answers
# would otherwise hold a probe open forever.
ready=
deadline=$((SECONDS + AGENT_STARTUP_SECONDS))
while [ "$SECONDS" -lt "$deadline" ]; do
  remaining=$((deadline - SECONDS))
  if curl -fsS --max-time $((remaining < 5 ? remaining : 5)) \
    http://localhost:8000/health >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$AGENT_PID" 2>/dev/null; then
    status=0
    wait "$AGENT_PID" || status=$?
    echo "[entrypoint] ERROR: the agent exited during startup with code $status" >&2
    exit $((status == 0 ? 1 : status))
  fi
  sleep 1
done
if [ -z "$ready" ]; then
  echo "[entrypoint] ERROR: the agent did not answer /health within ${AGENT_STARTUP_SECONDS}s" >&2
  stop_services
  exit 1
fi
echo "[entrypoint] Agent is up"

export PORT="${PORT:-3000}"
npx next start --hostname 0.0.0.0 --port "$PORT" > >(sed -u 's/^/[nextjs] /') 2>&1 &
NEXTJS_PID=$!

# If either service stops, stop the other and exit with its code, so Railway's
# ON_FAILURE policy restarts the container. A server that stops on its own is a
# failure even when it exits 0, so that becomes 1.
status=0
wait -n "$AGENT_PID" "$NEXTJS_PID" || status=$?
if kill -0 "$AGENT_PID" 2>/dev/null; then stopped=nextjs; else stopped=agent; fi
echo "[entrypoint] The $stopped process exited with code $status; stopping the other one" >&2
stop_services
exit $((status == 0 ? 1 : status))
