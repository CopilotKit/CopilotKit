#!/bin/bash
set -e

# Start agent backend
python -m uvicorn agent_server:app --host 0.0.0.0 --port 8000 &

# Start Next.js frontend (PORT defaults to 10000 for Render). Scope NODE_ENV
# to this exec only — `ENV NODE_ENV=production` at the image level would leak
# into every child process (Python agent, shell, healthchecks). `env` prefix
# binds the value to this single invocation.
env NODE_ENV=production npx next start --port ${PORT:-10000} &

# Wait for either process to exit
wait -n
exit $?
