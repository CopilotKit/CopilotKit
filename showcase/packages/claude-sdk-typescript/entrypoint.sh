#!/bin/bash
set -e

# Start Claude agent backend (TypeScript)
node /app/agent_server.js &

# Start Next.js frontend (PORT defaults to 10000 for Render)
npx next start --port ${PORT:-10000} &

# Wait for either process to exit
wait -n
exit $?
