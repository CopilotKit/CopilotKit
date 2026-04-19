#!/bin/bash
set -e

echo "[entrypoint] cell: ms-agent-dotnet / agentic-chat"
echo "[entrypoint] PORT=${PORT:-10000}"

# Find the published .NET agent DLL (csproj name varies per cell)
AGENT_DLL=$(ls /agent/*.dll | grep -v '\.deps\.' | head -1)
if [ -z "$AGENT_DLL" ]; then
  echo "[entrypoint] ERROR: could not locate published .NET agent DLL under /agent"
  exit 1
fi
echo "[entrypoint] launching .NET agent: $AGENT_DLL"

dotnet "$AGENT_DLL" --urls "http://0.0.0.0:8000" 2>&1 | sed 's/^/[dotnet] /' &
DOTNET_PID=$!
sleep 3

if ! kill -0 $DOTNET_PID 2>/dev/null; then
  echo "[entrypoint] ERROR: .NET agent failed to start"
fi

PORT=${PORT:-10000}
npx next start --port $PORT 2>&1 | sed 's/^/[nextjs] /' &
NEXTJS_PID=$!

wait -n
EXIT_CODE=$?
echo "[entrypoint] A process exited with code $EXIT_CODE"
exit $EXIT_CODE
