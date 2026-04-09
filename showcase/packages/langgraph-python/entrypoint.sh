#!/bin/bash
set -e

echo "========================================="
echo "[entrypoint] Starting showcase: langgraph-python"
echo "[entrypoint] Time: $(date -u)"
echo "[entrypoint] PWD: $(pwd)"
echo "[entrypoint] PORT=${PORT:-not set}"
echo "[entrypoint] NODE_ENV=${NODE_ENV:-not set}"
echo "========================================="

# Check critical env vars
echo "[entrypoint] Checking environment variables..."
if [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: OPENAI_API_KEY is not set! Agent will fail."
else
  echo "[entrypoint] OPENAI_API_KEY: set (${#OPENAI_API_KEY} chars)"
fi

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "[entrypoint] INFO: ANTHROPIC_API_KEY is not set"
else
  echo "[entrypoint] ANTHROPIC_API_KEY: set (${#ANTHROPIC_API_KEY} chars)"
fi

if [ -z "$LANGSMITH_API_KEY" ]; then
  echo "[entrypoint] INFO: LANGSMITH_API_KEY is not set (tracing disabled)"
else
  echo "[entrypoint] LANGSMITH_API_KEY: set (${#LANGSMITH_API_KEY} chars)"
fi

# Verify files exist
echo "[entrypoint] Checking files..."
ls -la langgraph.json 2>/dev/null && echo "[entrypoint] langgraph.json: OK" || echo "[entrypoint] ERROR: langgraph.json missing!"
ls -la src/agents/main.py 2>/dev/null && echo "[entrypoint] src/agents/main.py: OK" || echo "[entrypoint] ERROR: src/agents/main.py missing!"
ls -la src/agents/tools.py 2>/dev/null && echo "[entrypoint] src/agents/tools.py: OK" || echo "[entrypoint] ERROR: src/agents/tools.py missing!"
ls -la .next/server 2>/dev/null > /dev/null && echo "[entrypoint] .next/server: OK" || echo "[entrypoint] ERROR: .next build missing!"

echo "[entrypoint] langgraph.json contents:"
cat langgraph.json

echo "========================================="
echo "[entrypoint] Starting LangGraph agent server on port 8123..."
echo "========================================="

python -m langgraph_cli dev \
  --config langgraph.json \
  --host 0.0.0.0 \
  --port 8123 \
  --no-browser 2>&1 | sed 's/^/[langgraph] /' &
LANGGRAPH_PID=$!

# Give langgraph a moment to start
sleep 3

# Check if langgraph is still running
if kill -0 $LANGGRAPH_PID 2>/dev/null; then
  echo "[entrypoint] LangGraph agent server started (PID: $LANGGRAPH_PID)"
else
  echo "[entrypoint] ERROR: LangGraph agent server failed to start!"
  echo "[entrypoint] Continuing with Next.js only (demos will show agent errors)"
fi

echo "========================================="
echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
echo "========================================="

PORT=${PORT:-10000}
npx next start --port $PORT 2>&1 | sed 's/^/[nextjs] /' &
NEXTJS_PID=$!

echo "[entrypoint] Next.js started (PID: $NEXTJS_PID)"
echo "[entrypoint] Both processes running. Waiting..."

# Wait for either process to exit
wait -n
EXIT_CODE=$?
echo "[entrypoint] A process exited with code $EXIT_CODE"
exit $EXIT_CODE
