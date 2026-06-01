#!/bin/bash
set -e

echo "========================================="
echo "[entrypoint] Starting showcase package: built-in-agent"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] OPENAI_API_KEY=${OPENAI_API_KEY:+set}"
echo "========================================="

PORT=${PORT:-10000}
exec env NODE_ENV=production npx next start --port "$PORT"
