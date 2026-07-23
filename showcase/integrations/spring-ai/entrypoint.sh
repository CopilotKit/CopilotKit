#!/bin/bash
set -e

# Derive SPRING_AI_OPENAI_BASE_URL from the showcase-wide OPENAI_BASE_URL if
# not already set. The showcase convention is that OPENAI_BASE_URL includes
# "/v1" (e.g. https://aimock.example.com/v1), but Spring AI appends
# "/v1/chat/completions" itself, so we must strip the trailing "/v1" to avoid
# a doubled path segment.
if [ -z "${SPRING_AI_OPENAI_BASE_URL:-}" ] && [ -n "${OPENAI_BASE_URL:-}" ]; then
    export SPRING_AI_OPENAI_BASE_URL="${OPENAI_BASE_URL%/v1}"
    echo "[entrypoint] Derived SPRING_AI_OPENAI_BASE_URL=${SPRING_AI_OPENAI_BASE_URL} from OPENAI_BASE_URL=${OPENAI_BASE_URL}"
fi

echo "[entrypoint] Starting Spring Boot agent backend..."
# jdk.httpclient.keepalive.timeout=0 disables JDK HttpClient connection pooling.
# Required because Spring-AI streams via WebClient + JdkClientHttpConnector and a
# pooled connection can be half-closed by some upstreams (aimock/Prism) between
# SSE responses, which trips `Connection reset` on the follow-up tool-result
# request. Setting this as a JVM arg guarantees it lands before any
# java.net.http.HttpClient is constructed. This is the authoritative path;
# WebClientConfig's static initializer is a defensive fallback only.
#
# copilotkit.tool.max-iterations: override the BoundedToolCallingManager's
# cap via a JVM property so the pre-built jar picks it up without a
# rebuild. The application.properties inside the jar defaults to 5 via
# ${COPILOTKIT_TOOL_MAX_ITERATIONS:5}, but passing it as -D here ensures
# it takes effect even on images built before that property was added.
# D5 fixtures need at least 3 (subagents: research -> writing -> critique);
# 5 gives headroom for future multi-tool demos.
TOOL_MAX_ITER="${COPILOTKIT_TOOL_MAX_ITERATIONS:-5}"
echo "[entrypoint] copilotkit.tool.max-iterations=${TOOL_MAX_ITER}"
java -Djdk.httpclient.keepalive.timeout=0 \
     -Dcopilotkit.tool.max-iterations="${TOOL_MAX_ITER}" \
     -jar /app/agent.jar &
JAVA_PID=$!

# Wait for Spring Boot to be ready (up to 60 seconds). Cold-start JVM warmup
# plus Spring context refresh can legitimately exceed 30s under load — we
# also probe the Java PID each tick as a liveness fallback, so a crashing
# boot fails fast regardless of the cap.
STARTUP_TIMEOUT=60
echo "[entrypoint] Waiting for Spring Boot health check (timeout=${STARTUP_TIMEOUT}s)..."
SPRING_READY=0
for i in $(seq 1 "$STARTUP_TIMEOUT"); do
    if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
        echo "[entrypoint] Spring Boot ready after ${i}s"
        SPRING_READY=1
        break
    fi
    if ! kill -0 "$JAVA_PID" 2>/dev/null; then
        echo "[entrypoint] Spring Boot process (pid=${JAVA_PID}) died during startup"
        exit 1
    fi
    sleep 1
done

if [ "$SPRING_READY" -ne 1 ]; then
    # Differentiate "slow" from "dead" so operators know whether to raise
    # the timeout or debug a crash loop.
    if kill -0 "$JAVA_PID" 2>/dev/null; then
        echo "[entrypoint] Spring Boot still alive (pid=${JAVA_PID}) but /health did not return 2xx within ${STARTUP_TIMEOUT}s"
    else
        echo "[entrypoint] Spring Boot process (pid=${JAVA_PID}) exited before reporting healthy"
    fi
    exit 1
fi

echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
# Scope NODE_ENV=production to the Next.js invocation ONLY so it doesn't
# leak into the Java agent process. See Dockerfile comment for rationale.
env NODE_ENV=production npx next start --port ${PORT:-10000} &
NODE_PID=$!

# Watchdog: Railway deploys of showcase packages have been observed to hit a
# silent agent hang — the Spring Boot process stays alive (so `wait -n`
# never fires and the container never restarts) but stops responding on
# :8000. Poll Spring Boot's /health endpoint every 30s; after 3 consecutive
# failures (~90s of unreachable agent), kill the java process so `wait -n`
# returns and Railway restarts the container. The startup probe above
# already gates the initial readiness window; this watchdog takes over for
# steady-state monitoring. Generalized from
# showcase/integrations/crewai-crews/entrypoint.sh (PRs #4114 + #4115).
(
    FAILS=0
    while sleep 30; do
        if ! kill -0 "$JAVA_PID" 2>/dev/null; then
            break
        fi
        if curl -fsS --max-time 5 http://127.0.0.1:8000/health > /dev/null 2>&1; then
            FAILS=0
        else
            FAILS=$((FAILS + 1))
            echo "[watchdog] Agent health probe failed (count=$FAILS)"
            if [ $FAILS -ge 3 ]; then
                echo "[watchdog] Agent unresponsive for ~90s — killing PID $JAVA_PID to trigger container restart"
                kill -9 "$JAVA_PID" 2>/dev/null || true
                break
            fi
        fi
    done
) &
WATCHDOG_PID=$!
echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID, probing http://127.0.0.1:8000/health)"

# Wait for either process to exit. `wait -n` without PID args works on all
# bash >= 4.3 (align with other showcase entrypoints such as google-adk);
# the PID-args form requires bash 5.1+ which isn't guaranteed in minimal
# container images.
#
# Disable errexit for the wait + post-mortem block. With `set -e` still active,
# a non-zero child-exit code from `wait -n` would terminate the shell BEFORE we
# get a chance to run the diagnostic `kill -0` probes below — meaning the
# container log would never carry the "which died" line that operators rely on.
# We capture the exit code explicitly into EXIT_CODE and the final
# `exit "$EXIT_CODE"` propagates the dying child's status, so skipping errexit
# here doesn't change the container exit semantics. Restoration of `set -e` is
# intentionally omitted (mirrors google-adk's entrypoint).
set +e
wait -n
EXIT_CODE=$?

# Identify which process exited AND kill the surviving sibling so it doesn't
# get orphan-reparented to PID 1 when the container exits. Without this
# explicit cleanup, a Java crash would leave Next.js alive (and vice versa)
# consuming resources until the container runtime tears down the whole
# process tree.
SURVIVOR_PID=""
if ! kill -0 "$JAVA_PID" 2>/dev/null; then
    echo "[entrypoint] Java process (pid=${JAVA_PID}) exited (code=${EXIT_CODE})"
    if kill -0 "$NODE_PID" 2>/dev/null; then
        SURVIVOR_PID="$NODE_PID"
    fi
elif ! kill -0 "$NODE_PID" 2>/dev/null; then
    echo "[entrypoint] Node.js process (pid=${NODE_PID}) exited (code=${EXIT_CODE})"
    if kill -0 "$JAVA_PID" 2>/dev/null; then
        SURVIVOR_PID="$JAVA_PID"
    fi
else
    echo "[entrypoint] A child exited (code=${EXIT_CODE}); both PIDs still resolve — race between wait and kill -0"
fi

if [ -n "$SURVIVOR_PID" ]; then
    # Bounded grace window. A plain `wait` on the survivor could hang
    # indefinitely (e.g. Node.js stuck flushing a response, Java caught in a
    # finalizer) — which would push us past the platform's SIGKILL grace
    # period (typically 10s on Railway/ECS) and cause the runtime to reap
    # us mid-log-write, losing the structured "who died" line we just
    # emitted. SIGTERM first, poll `kill -0` for up to SURVIVOR_GRACE_SECS,
    # then SIGKILL as last resort. Mirrors what the comment above this
    # block already promised.
    SURVIVOR_GRACE_SECS=10
    echo "[entrypoint] Terminating surviving sibling (pid=${SURVIVOR_PID}) to avoid orphan-reparent (grace=${SURVIVOR_GRACE_SECS}s)"
    kill -TERM "$SURVIVOR_PID" 2>/dev/null
    for _ in $(seq 1 "$SURVIVOR_GRACE_SECS"); do
        if ! kill -0 "$SURVIVOR_PID" 2>/dev/null; then
            break
        fi
        sleep 1
    done
    if kill -0 "$SURVIVOR_PID" 2>/dev/null; then
        echo "[entrypoint] Survivor (pid=${SURVIVOR_PID}) did not exit within ${SURVIVOR_GRACE_SECS}s; sending SIGKILL"
        kill -KILL "$SURVIVOR_PID" 2>/dev/null || true
    fi
    # Reap the (now-dead) child so it doesn't become a zombie. wait may
    # return non-zero; we don't care — we've already captured EXIT_CODE
    # from the first-to-die child.
    wait "$SURVIVOR_PID" 2>/dev/null || true
fi

# Clean up the watchdog if it's still running (e.g. Next.js exited, not Java).
# Without this the backgrounded watchdog would continue polling /health on a
# dying container until the platform SIGKILLs the process tree.
if [ -n "${WATCHDOG_PID:-}" ] && kill -0 "$WATCHDOG_PID" 2>/dev/null; then
    kill "$WATCHDOG_PID" 2>/dev/null || true
fi

exit "$EXIT_CODE"
