#!/bin/bash
set -e

echo "[entrypoint] Starting Spring Boot agent backend..."
# jdk.httpclient.keepalive.timeout=0 disables JDK HttpClient connection pooling.
# Required because Spring-AI streams via WebClient + JdkClientHttpConnector and a
# pooled connection can be half-closed by some upstreams (aimock/Prism) between
# SSE responses, which trips `Connection reset` on the follow-up tool-result
# request. Setting this as a JVM arg guarantees it lands before any
# java.net.http.HttpClient is constructed.
java -Djdk.httpclient.keepalive.timeout=0 -jar /app/agent.jar &
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
