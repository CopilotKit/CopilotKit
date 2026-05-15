#!/bin/bash
set -e

echo "========================================="
echo "[entrypoint] PORT=${PORT:-10000}"
echo "[entrypoint] Starting Next.js frontend..."
echo "========================================="

# Scope NODE_ENV=production to the Next.js invocation ONLY. Image-scope
# ENV NODE_ENV=production would leak into any child process (shell scripts,
# healthchecks, future agent subprocesses) — for parity with other packages
# we scope it here.
exec env NODE_ENV=production npx next start --port "${PORT:-10000}"
