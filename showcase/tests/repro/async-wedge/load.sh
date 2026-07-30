#!/usr/bin/env bash
# Fire N concurrent POST /generate requests to saturate the single uvicorn
# event loop. Each request drives a multi-second sync anthropic call; under the
# RED topology the first one parks the loop and /health goes unresponsive.
set -u
PORT="${PORT:-8000}"
CONCURRENCY="${CONCURRENCY:-5}"
for _ in $(seq 1 "$CONCURRENCY"); do
  curl -s -o /dev/null --max-time 30 -X POST "http://127.0.0.1:${PORT}/generate" &
done
wait
