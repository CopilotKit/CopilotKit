#!/bin/bash
# dev-entrypoint.sh — fast-iteration container entrypoint for `showcase up --dev`.
#
# Unlike the per-integration production entrypoint.sh (which runs the BAKED
# image artifacts — `next start` + a non-reloading agent server), this
# entrypoint runs the BIND-MOUNTED SOURCE (`/app/src`, mounted by
# docker-compose.dev.yml) under each stack's native file-watch reloader so an
# edit to a source file hot-reloads the component WITHOUT an image rebuild.
#
# The built-image mode remains the faithful/staging-equivalent default; this
# path trades fidelity for iteration speed. It reuses the SAME image (so the
# venv / node_modules baked at build time are present) — only the run command
# differs (source-mounted + auto-reload).
#
# Stack detection (self-contained, no per-integration script needed):
#   * Python agent  → present iff `/app/src/agent_server.py` exists (FastAPI/
#                     uvicorn) OR `/app/langgraph.json` exists (langgraph dev,
#                     which already hot-reloads its graph). Run with
#                     `uvicorn --reload` watching `/app/src`.
#   * Next.js front → present iff `/app/package.json` has a `dev` script. Run
#                     `next dev` (Turbopack/webpack file-watch) on $PORT.
#
# Each detected process is launched in the background with a log prefix; the
# script waits on whichever exits first (mirrors the production entrypoint's
# `wait -n` discipline) so a crash surfaces and the container restarts.
set -e

PORT=${PORT:-10000}
export PYTHONUNBUFFERED=1

echo "========================================="
echo "[dev-entrypoint] FAST DEV MODE (bind-mounted source + hot reload)"
echo "[dev-entrypoint] Time: $(date -u)"
echo "[dev-entrypoint] PWD: $(pwd)  PORT=${PORT}"
echo "[dev-entrypoint] NOTE: this is NOT the faithful built-image path."
echo "========================================="

PIDS=()

cleanup() {
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

# ── Python agent (uvicorn --reload) ──────────────────────────────────────
if [ -f /app/src/agent_server.py ]; then
  echo "[dev-entrypoint] Detected FastAPI agent (src/agent_server.py) — uvicorn --reload on :8000"
  # Run from the bind-mounted source dir so uvicorn imports + watches the
  # LIVE source, not the baked /app/agent_server.py copy. PYTHONPATH includes
  # /app so shared `tools/` (baked at /app/tools) still resolves.
  (
    cd /app/src
    # `stdbuf -oL -eL` forces line-buffering on the pipe so uvicorn's
    # WatchFiles "Detected change / Reloading" lines reach `docker logs`
    # immediately (the awk `fflush()` only flushes awk's own buffer).
    PYTHONPATH=/app/src:/app stdbuf -oL -eL python -u -m uvicorn agent_server:app \
      --host 0.0.0.0 --port 8000 \
      --reload --reload-dir /app/src \
      2>&1 | stdbuf -oL awk '{print "[agent] " $0; fflush()}'
  ) &
  PIDS+=("$!")
elif [ -f /app/langgraph.json ]; then
  echo "[dev-entrypoint] Detected langgraph.json — langgraph dev (hot-reloads graph) on :8123"
  (
    stdbuf -oL -eL python -u -m langgraph_cli dev \
      --config langgraph.json --host 0.0.0.0 --port 8123 --no-browser \
      2>&1 | stdbuf -oL awk '{print "[langgraph] " $0; fflush()}'
  ) &
  PIDS+=("$!")
fi

# ── Next.js frontend (next dev — file-watch hot reload) ──────────────────
if [ -f /app/package.json ] && grep -q '"dev"' /app/package.json; then
  echo "[dev-entrypoint] Detected Next.js — next dev (hot reload) on :${PORT}"
  (
    cd /app
    # `next dev` watches src/ (bind-mounted) and rebuilds on change. Do NOT
    # set NODE_ENV=production here — dev mode needs the development runtime.
    npx next dev --port "$PORT" \
      2>&1 | stdbuf -oL awk '{print "[nextjs] " $0; fflush()}'
  ) &
  PIDS+=("$!")
fi

if [ ${#PIDS[@]} -eq 0 ]; then
  echo "[dev-entrypoint] ERROR: no known stack detected (no agent_server.py / langgraph.json / next dev script)."
  exit 1
fi

echo "[dev-entrypoint] Launched ${#PIDS[@]} process(es): ${PIDS[*]} — waiting (hot reload active)."
wait -n "${PIDS[@]}"
EXIT_CODE=$?
echo "[dev-entrypoint] A process exited with code $EXIT_CODE"
exit $EXIT_CODE
