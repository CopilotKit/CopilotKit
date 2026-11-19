#!/usr/bin/env bash
# Start the ADK agent, wait until it accepts connections, then start the web
# server. If either process exits, stop the other and exit with its status,
# so the platform restarts the container.
set -euo pipefail

AGENT_PORT="${AGENT_PORT:-8014}"
export PORT="${PORT:-3000}"

# The agent reads AGENT_PORT only. Unset PORT for it so nothing in its stack
# picks up the web server's port.
(cd /app/agent && exec env -u PORT .venv/bin/python main.py) &
agent_pid=$!

for _ in $(seq 1 120); do
  if (exec 3<>"/dev/tcp/127.0.0.1/${AGENT_PORT}") 2>/dev/null; then
    break
  fi
  if ! kill -0 "$agent_pid" 2>/dev/null; then
    echo "start.sh: agent exited before it was ready" >&2
    wait "$agent_pid" || exit $?
    exit 1
  fi
  sleep 0.5
done

if ! (exec 3<>"/dev/tcp/127.0.0.1/${AGENT_PORT}") 2>/dev/null; then
  echo "start.sh: agent did not open port ${AGENT_PORT} within 60s" >&2
  kill "$agent_pid" 2>/dev/null || true
  exit 1
fi
echo "start.sh: agent ready on ${AGENT_PORT}; starting web on ${PORT}"

node /app/web/serve.mjs &
web_pid=$!

stopping=0
trap 'stopping=1; kill -TERM "$agent_pid" "$web_pid" 2>/dev/null || true' TERM INT

# Exit as soon as either process exits.
set +e
wait -n "$agent_pid" "$web_pid"
status=$?
if [ "$stopping" = 1 ]; then
  wait
  exit 0
fi
echo "start.sh: a process exited (status ${status}); shutting down" >&2
kill -TERM "$agent_pid" "$web_pid" 2>/dev/null
wait
# A process that stops on its own is a failure even when it exits 0 (uvicorn
# does on SIGTERM), so the ON_FAILURE restart policy always applies.
[ "$status" = 0 ] && status=1
exit "$status"
