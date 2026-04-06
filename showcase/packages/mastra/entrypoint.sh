#!/bin/bash
set -e

echo "========================================="
echo "[entrypoint] PORT=${PORT:-10000}"
echo "[entrypoint] Starting Next.js frontend..."
echo "========================================="

exec npx next start --port "${PORT:-10000}"
