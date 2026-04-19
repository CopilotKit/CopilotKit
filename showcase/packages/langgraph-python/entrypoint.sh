#!/bin/bash
# Launch one langgraph server + one Next.js server per cell, each on its
# own internal port. All processes share /app/.venv (Python) and
# /app/node_modules (Node) — installed once at build time via workspaces.
set -u

echo "[entrypoint] column: langgraph-python"
echo "[entrypoint] OPENAI_API_KEY: ${OPENAI_API_KEY:+set}"
echo "[entrypoint] LANGSMITH_API_KEY: ${LANGSMITH_API_KEY:+set}"

pids=()
i=0

# Sort cell names (without trailing slash) so ASCII '/' doesn't reorder
# hyphenated prefixes like agentic-chat vs agentic-chat-reasoning.
# Must match sync-lgp-ports.mjs (JS string sort without slashes).
for cell in $(ls demos/ | LC_ALL=C sort); do
  next_port=$((10000 + i))
  lg_port=$((8123 + i))

  echo "[entrypoint] $cell → Next.js :$next_port, langgraph :$lg_port"

  # langgraph — shared /app/.venv. Wrapped in a forever-loop so an OOM-kill
  # (common with 50 concurrent dev processes in a memory-constrained VM)
  # respawns the process instead of silently leaving a cell blank.
  (
    cd "/app/demos/$cell/backend"
    while true; do
      python -m langgraph_cli dev \
        --config langgraph.json \
        --host 0.0.0.0 \
        --port "$lg_port" \
        --no-browser > >(sed "s|^|[$cell-lg] |") 2>&1
      echo "[$cell-lg] exited with $? — respawning in 2s"
      sleep 2
    done
  ) &
  pids+=("$!")

  # Next.js — shared /app/node_modules via npm workspaces. Same respawn loop.
  (
    cd "/app/demos/$cell/frontend"
    while true; do
      LANGGRAPH_DEPLOYMENT_URL="http://localhost:$lg_port" \
        npx next dev -p "$next_port" > >(sed "s|^|[$cell-next] |") 2>&1
      echo "[$cell-next] exited with $? — respawning in 2s"
      sleep 2
    done
  ) &
  pids+=("$!")

  i=$((i + 1))
done

echo "[entrypoint] ${#pids[@]} processes launched. Waiting..."
# `wait` (no -n) keeps the container alive as long as any child process
# lives. Using `wait -n` would tear the whole container down the moment a
# single cell's Next/langgraph process exited — including clean exits.
wait
echo "[entrypoint] all child processes exited"
