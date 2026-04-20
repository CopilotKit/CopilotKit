#!/bin/bash
set -e

echo "[entrypoint] cell: mastra / agentic-chat"
echo "[entrypoint] PORT=${PORT:-10000}"

# Mastra is in-process with Next.js via `MastraAgent.getLocalAgents` —
# there is no separate agent server to start.
exec npx next start --port "${PORT:-10000}"
