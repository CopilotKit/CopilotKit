#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# Bounded terminate helper + shutdown trap.
#
# _terminate_pid sends SIGTERM, polls `kill -0` for up to SURVIVOR_GRACE_SECS,
# then SIGKILLs as a last resort, and finally reaps the child so it cannot
# become a zombie. A plain `wait` on the target could hang indefinitely (e.g.
# Node.js stuck flushing a response, Java caught in a finalizer), which would
# push us past the platform's SIGKILL grace period (typically 10s on
# Railway/ECS) and get us reaped mid-log-write.
#
# LIMITATION, stated honestly: NODE_PID is the `env … npx next start` process,
# which may fork the real Next.js `node` server as a child. This helper signals
# only that one PID — if npx does not forward the signal, the node server can
# still survive as an orphan holding $PORT. The four tree-kill entrypoints
# (mastra, langgraph-typescript, ms-agent-dotnet, strands-typescript) solve that
# class with a /proc process-tree walk; spring-ai has not adopted it yet.
SURVIVOR_GRACE_SECS=10
_terminate_pid() {
  local pid="$1" label="$2"
  case "$pid" in
    ''|*[!0-9]*) return 0 ;;
  esac
  [ "$pid" -le 1 ] && return 0
  kill -0 "$pid" 2>/dev/null || return 0
  echo "[entrypoint] Terminating ${label} (pid=${pid}, grace=${SURVIVOR_GRACE_SECS}s)"
  kill -TERM "$pid" 2>/dev/null || true
  local _i
  for _i in $(seq 1 "$SURVIVOR_GRACE_SECS"); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "[entrypoint] ${label} (pid=${pid}) did not exit within ${SURVIVOR_GRACE_SECS}s; sending SIGKILL"
    kill -KILL "$pid" 2>/dev/null || true
  fi
  # Reap the (now-dead) child so it doesn't become a zombie. wait may return
  # non-zero; we don't care.
  wait "$pid" 2>/dev/null || true
}

# Shutdown trap. EXIT alone does NOT cover SIGTERM: an untrapped SIGTERM kills
# bash by signal and the EXIT trap never runs — and SIGTERM is exactly what
# Railway sends on every redeploy/rollover. Without this trap both children
# were orphan-reparented to PID 1 on that path, still holding :$AGENT_PORT and
# $PORT, so the replacement container could not bind. Idempotent: every kill is
# guarded by `kill -0`, so running it after the post-mortem block below (which
# already terminates the survivor) is a no-op.
#
# SHAPE: spring-ai, strands and langgraph-python are the only three files that
# use this shorter two-trap form (`trap _on_signal INT TERM`, unconditional
# 143). Every other entrypoint — with ONE exception, named below — splits INT
# from TERM so the handler can report 130 vs 143. The design is the same in all
# of them: a `_CLEANED` flag, an EXIT trap for the normal path, and a signal
# handler that exits instead of falling back into the script.
#
# THE EXCEPTION IS built-in-agent, which carries NONE of this — no `_CLEANED`,
# no trap, no signal handler — and needs none. It is a single
# `exec env NODE_ENV=production npx next start`, so Next.js REPLACES the shell
# instead of running beside it: the platform's SIGTERM reaches Next.js directly,
# there is no shell left to trap it, and there is no second child to reap. Do
# not "fix" it by adding traps.
_CLEANED=0
cleanup() {
  [ "$_CLEANED" = "1" ] && return 0
  _CLEANED=1
  _terminate_pid "${JAVA_PID:-}" "Java agent"
  _terminate_pid "${NODE_PID:-}" "Next.js"
  if [ -n "${WATCHDOG_PID:-}" ] && kill -0 "$WATCHDOG_PID" 2>/dev/null; then
    kill "$WATCHDOG_PID" 2>/dev/null || true
  fi
}
_on_signal() {
  echo "[entrypoint] Received shutdown signal — terminating children"
  cleanup
  # 143 = 128 + SIGTERM, the conventional shell exit code for a SIGTERM death.
  exit 143
}
trap cleanup EXIT
trap _on_signal INT TERM

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

# Agent listen port. Deliberately AGENT_PORT and NOT PORT: this container still
# runs Next.js on $PORT, and two processes cannot bind the same port — pointing
# the agent at $PORT would collide and break the container. AGENT_PORT is unset
# in every deploy today, so Spring Boot still lands on 8000 (the same value
# application.properties bakes into the jar) and behaviour is byte-for-byte
# unchanged.
#
# AGENT_PORT IS NOT A STANDALONE KNOB. It moves ONLY Spring Boot's listen port.
# Every Next.js route in src/app/api/* reads `process.env.AGENT_URL ||
# "http://localhost:8000"`, so setting AGENT_PORT alone moves the agent away
# from the port the frontend still dials — every demo breaks while this
# entrypoint's startup probe and watchdog (which follow AGENT_PORT) keep
# reporting healthy. To change the agent port you MUST set AGENT_URL to match:
#   AGENT_PORT=9000 AGENT_URL=http://localhost:9000
#
# Passed as -Dserver.port for the same reason as -Dcopilotkit.tool.max-iterations
# above: a JVM property overrides the pre-built jar's application.properties
# without a rebuild.
AGENT_PORT="${AGENT_PORT:-8000}"
echo "[entrypoint] server.port=${AGENT_PORT}"
# Log prefixing: `&> >(while IFS= read -r line; …)`, the same form every other
# two-process showcase entrypoint uses. Without it the JVM and Next.js lines
# interleave in `docker logs` with no attribution, which is worst here — these
# are the two runtimes hardest to tell apart by their output alone. The prefixer
# is a bash `while read` loop and NOT `awk`: the images block-buffer awk's INPUT,
# so `fflush()` never fires for a long-lived child and its lines never reach
# `docker logs`. Full explanation in showcase/integrations/mastra/entrypoint.sh.
# `&>` into a process substitution, NOT a pipe: this stays a SIMPLE COMMAND with
# a redirection, so bash forks once and execs `java` in that child and $! is
# still the JVM itself — the prefixer runs in a separate child of its own. A pipe
# would make $! the log formatter and silently break the startup probe, the
# watchdog and `wait -n` below, all of which key off JAVA_PID.
java -Djdk.httpclient.keepalive.timeout=0 \
     -Dcopilotkit.tool.max-iterations="${TOOL_MAX_ITER}" \
     -Dserver.port="${AGENT_PORT}" \
     -jar /app/agent.jar &> >(while IFS= read -r line; do printf '[agent] %s\n' "$line"; done) &
JAVA_PID=$!

# Wait for Spring Boot to be ready. Cold-start JVM warmup plus Spring context
# refresh can legitimately exceed 30s under load — we also probe the Java PID
# each tick as a liveness fallback, so a crashing boot fails fast regardless of
# the cap.
#
# STARTUP_TIMEOUT is an ATTEMPT budget, not a wall-clock budget. Each attempt
# costs `sleep 1` plus however long the probe takes, and the probe is bounded by
# `curl --max-time 5` (same form as the watchdog below). So 60 attempts is
# ~60s when the agent answers or refuses the connection fast (the normal case),
# and AT MOST ~360s (60 x (5s probe + 1s sleep)) if every probe hangs to its
# own timeout. It was previously UNBOUNDED: without `--max-time`, a JVM that
# accepts the TCP connection mid-startup and never answers parks the probe
# forever, so the attempt budget bounded nothing at all.
#
# Probe form is deliberately IDENTICAL to the watchdog's below:
#   - `--max-time 5` so one hung probe fails that attempt instead of the loop.
#   - `127.0.0.1`, not `localhost`: `localhost` can resolve to `::1` first, and
#     an IPv4-only JVM bind then fails the probe for a reason that has nothing
#     to do with agent health.
STARTUP_TIMEOUT=60
echo "[entrypoint] Waiting for Spring Boot health check (up to ${STARTUP_TIMEOUT} attempts, ~${STARTUP_TIMEOUT}s nominal / ~$((STARTUP_TIMEOUT * 6))s worst case)..."
SPRING_READY=0
for i in $(seq 1 "$STARTUP_TIMEOUT"); do
    if curl -fsS --max-time 5 "http://127.0.0.1:${AGENT_PORT}/health" > /dev/null 2>&1; then
        echo "[entrypoint] Spring Boot ready after ${i} attempt(s)"
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
        echo "[entrypoint] Spring Boot still alive (pid=${JAVA_PID}) but /health did not return 2xx within ${STARTUP_TIMEOUT} attempts"
    else
        echo "[entrypoint] Spring Boot process (pid=${JAVA_PID}) exited before reporting healthy"
    fi
    exit 1
fi

echo "[entrypoint] Starting Next.js frontend on port ${PORT:-10000}..."
# Scope NODE_ENV=production to the Next.js invocation ONLY so it doesn't
# leak into the Java agent process. See Dockerfile comment for rationale.
# Same `&> >(while read …)` prefixer as the Java launch above, and for the same
# reason: this line stays a simple command with a redirection, so $! is still the
# `env`→`npx next start` process and NOT the log formatter.
env NODE_ENV=production npx next start --port ${PORT:-10000} &> >(while IFS= read -r line; do printf '[nextjs] %s\n' "$line"; done) &
NODE_PID=$!

# Watchdog: Railway deploys of showcase packages have been observed to hit a
# silent agent hang — the Spring Boot process stays alive (so `wait -n`
# never fires and the container never restarts) but stops responding on
# :$AGENT_PORT. Poll Spring Boot's /health endpoint every 30s; after 3
# consecutive failures (~90s of unreachable agent), kill the java process so
# `wait -n` returns and Railway restarts the container. The startup probe above
# already gates the initial readiness window; this watchdog takes over for
# steady-state monitoring. Generalized from
# showcase/integrations/crewai-crews/entrypoint.sh (PRs #4114 + #4115).
(
    FAILS=0
    while sleep 30; do
        if ! kill -0 "$JAVA_PID" 2>/dev/null; then
            break
        fi
        if curl -fsS --max-time 5 "http://127.0.0.1:${AGENT_PORT}/health" > /dev/null 2>&1; then
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
echo "[entrypoint] Watchdog started (PID: $WATCHDOG_PID, probing http://127.0.0.1:${AGENT_PORT}/health)"

# Wait for either REAL process to exit — the two PIDs are passed EXPLICITLY.
#
# An arg-less `wait -n` waits for ANY child, INCLUDING the watchdog subshell.
# The watchdog breaks out of its loop as soon as it sees Java dead, so on a
# Java crash `wait -n` could reap the WATCHDOG first and return ITS status (0)
# — the container would exit 0 on a crash (no Railway restart), and the
# post-mortem below would find both real PIDs still resolving and misreport a
# routine watchdog exit as a "race between wait and kill -0".
#
# The old comment justified the arg-less form on bash-version grounds: the
# PID-args and `-p` forms need bash >= 5.1. That premise does not hold here —
# this container's runner stage is `eclipse-temurin:21-jre`, which ships bash
# 5.1+. langgraph-typescript and mastra already rely on `wait -n -p`.
#
# Disable errexit for the wait + post-mortem block. With `set -e` still active,
# a non-zero child-exit code from `wait -n` would terminate the shell BEFORE we
# get a chance to run the diagnostics below — meaning the container log would
# never carry the "which died" line that operators rely on. We capture the exit
# code explicitly into EXIT_CODE and the final `exit "$EXIT_CODE"` propagates
# the dying child's status, so skipping errexit here doesn't change the
# container exit semantics. Restoration of `set -e` is intentionally omitted.
#
# REAPED_PID via `wait -n -p VAR` captures the ACTUAL PID `wait -n` reaped, so
# the diagnostic names the correct process even when both die near-
# simultaneously — a `kill -0` probe AFTER the wait only INFERS it.
set +e
REAPED_PID=""
wait -n -p REAPED_PID "$JAVA_PID" "$NODE_PID"
EXIT_CODE=$?

# Identify which process exited AND kill the surviving sibling so it doesn't
# get orphan-reparented to PID 1 when the container exits. Without this
# explicit cleanup, a Java crash would leave Next.js alive (and vice versa)
# consuming resources until the container runtime tears down the whole
# process tree.
SURVIVOR_PID=""
if [ "$REAPED_PID" = "$JAVA_PID" ]; then
    echo "[entrypoint] Java process (pid=${JAVA_PID}) exited (code=${EXIT_CODE})"
    SURVIVOR_PID="$NODE_PID"
elif [ "$REAPED_PID" = "$NODE_PID" ]; then
    echo "[entrypoint] Node.js process (pid=${NODE_PID}) exited (code=${EXIT_CODE})"
    SURVIVOR_PID="$JAVA_PID"
else
    echo "[entrypoint] A child (pid=${REAPED_PID:-unknown}) exited (code=${EXIT_CODE}) — terminating both known children"
    _terminate_pid "$JAVA_PID" "Java agent"
    _terminate_pid "$NODE_PID" "Next.js"
fi

if [ -n "$SURVIVOR_PID" ]; then
    _terminate_pid "$SURVIVOR_PID" "surviving sibling"
fi

# Clean up the watchdog if it's still running (e.g. Next.js exited, not Java).
# Without this the backgrounded watchdog would continue polling /health on a
# dying container until the platform SIGKILLs the process tree.
if [ -n "${WATCHDOG_PID:-}" ] && kill -0 "$WATCHDOG_PID" 2>/dev/null; then
    kill "$WATCHDOG_PID" 2>/dev/null || true
fi

# Mark cleanup done: everything the EXIT trap would do has just been done on
# this path, and re-running it would re-log the same terminate lines.
_CLEANED=1

exit "$EXIT_CODE"
