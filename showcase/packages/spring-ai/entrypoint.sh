#!/bin/bash
set -e

echo "[entrypoint] Starting Spring Boot agent backend..."
java -jar /app/agent.jar &
JAVA_PID=$!

# Wait for Spring Boot to be ready (up to 30 seconds)
echo "[entrypoint] Waiting for Spring Boot health check..."
for i in $(seq 1 30); do
    if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
        echo "[entrypoint] Spring Boot ready after ${i}s"
        break
    fi
    if ! kill -0 $JAVA_PID 2>/dev/null; then
        echo "[entrypoint] Spring Boot process died"
        exit 1
    fi
    sleep 1
done

# Verify it's actually up
if ! curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo "[entrypoint] Spring Boot failed to start within 30s"
    exit 1
fi

echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
npx next start --port ${PORT:-10000} &
NODE_PID=$!

# Wait for either process to exit
wait -n $JAVA_PID $NODE_PID
exit $?
