#!/bin/bash
set -e

# Start .NET agent backend
dotnet /agent/ProverbsAgent.dll --urls "http://0.0.0.0:8000" &

# Start Next.js frontend (PORT defaults to 10000 for Render)
npx next start --port ${PORT:-10000} &

# Wait for either process to exit
wait -n
exit $?
