#!/bin/bash
set -e

# Start agent backend
python -m uvicorn agent_server:app --host 0.0.0.0 --port 8000 &

# Start Next.js frontend (PORT defaults to 10000 for Render). Scope NODE_ENV
# to only this process — setting it at image level would silently disable the
# Python aimock toggle on this container (aimock_toggle.py refuses when
# NODE_ENV=production), breaking Docker-based smoke tests.
NODE_ENV=production npx next start --port ${PORT:-10000} &

# Wait for either process to exit
wait -n
exit $?
