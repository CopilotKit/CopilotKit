#!/usr/bin/env sh
set -eu

dotnet /app/agent/MsAgentHarnessControlRoom.Agent.dll &
agent_pid="$!"

export HOSTNAME=0.0.0.0
export PORT="${PORT:-8080}"

node /app/ui/server.js &
ui_pid="$!"

term() {
  kill "$agent_pid" "$ui_pid" 2>/dev/null || true
}
trap term INT TERM

while :; do
  if ! kill -0 "$agent_pid" 2>/dev/null; then
    wait "$agent_pid"
    exit $?
  fi
  if ! kill -0 "$ui_pid" 2>/dev/null; then
    wait "$ui_pid"
    exit $?
  fi
  sleep 1
done
