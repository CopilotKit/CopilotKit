#!/bin/bash
set -e

echo "[entrypoint] cell: spring-ai / agentic-chat"
echo "[entrypoint] PORT=${PORT:-10000}"

echo "[entrypoint] Starting Spring Boot agent backend on :8000..."
java -jar /app/agent.jar > >(sed 's/^/[spring] /') 2>&1 &
JAVA_PID=$!

# Wait for Spring Boot (up to 60s)
for i in $(seq 1 60); do
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo "[entrypoint] Spring Boot ready after ${i}s"
    break
  fi
  if ! kill -0 $JAVA_PID 2>/dev/null; then
    echo "[entrypoint] ERROR: Spring Boot process exited before becoming healthy"
    exit 1
  fi
  sleep 1
done

if ! curl -sf http://localhost:8000/health > /dev/null 2>&1; then
  echo "[entrypoint] ERROR: Spring Boot failed health check within 60s"
  exit 1
fi

echo "[entrypoint] Starting Next.js on :${PORT:-10000}..."
npx next start --port ${PORT:-10000} > >(sed 's/^/[nextjs] /') 2>&1 &
NODE_PID=$!

wait -n $JAVA_PID $NODE_PID
EXIT_CODE=$?
echo "[entrypoint] A process exited with code $EXIT_CODE"
exit $EXIT_CODE
