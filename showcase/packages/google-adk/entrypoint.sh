#!/bin/bash
set -e

# Disable Google ADK's progressive SSE streaming feature. With it enabled,
# Gemini 2.5-flash occasionally returns a stream whose final event is flagged
# `partial`, which the ADK flow aborts with a "The last event is partial"
# warning — the backend then emits no TOOL_CALL_* or TEXT_MESSAGE_* events,
# so the tool-rendering UI is stranded and L4 smoke tests intermittently fail.
# With it OFF the ADK falls back to simple text accumulation and always
# produces a coherent final response.
#
# This env var is belt-and-suspenders with `simple_after_model_modifier` in
# `src/agents/main.py`, which carries an in-callback partial-event guard. The
# env var is the primary (operator-level, ADK-wide) workaround; the callback
# guard runs regardless. Both layers are intentional.
export ADK_DISABLE_PROGRESSIVE_SSE_STREAMING=1

# Warn (default) or fail-fast when OPENAI_API_KEY is missing. Only
# `generate_a2ui` depends on it; other demos (weather, sales todos,
# query_data, search_flights, schedule_meeting) in this container continue to
# work without it. Default behavior is warn-and-continue so operators can
# bring the container up for non-A2UI demos. generate_a2ui itself returns a
# structured `a2ui_llm_error` dict at request time when the key is missing,
# so callers see a clean error surface.
#
# For production deployments that MUST have the key, set
# `REQUIRE_OPENAI_API_KEY=1` to escalate to fail-fast: the entrypoint exits
# non-zero immediately instead of surfacing the problem lazily at request
# time. Railway / compose overrides should set this in prod environments.
if [ -z "${OPENAI_API_KEY:-}" ]; then
    if [ "${REQUIRE_OPENAI_API_KEY:-0}" = "1" ]; then
        echo "[entrypoint] FATAL: OPENAI_API_KEY not set and REQUIRE_OPENAI_API_KEY=1 — refusing to start" >&2
        exit 1
    fi
    echo "[entrypoint] WARN: OPENAI_API_KEY not set — generate_a2ui demo will return a structured error at request time (other demos unaffected)" >&2
fi

# Start agent backend.
# NOTE: `set -e` does not fire on backgrounded processes — if uvicorn crashes
# immediately, the shell still proceeds to start Next.js. We capture PIDs and
# probe them explicitly after `wait -n` so operators can tell which process
# died with which exit code.
python -m uvicorn agent_server:app --host 0.0.0.0 --port 8000 &
AGENT_PID=$!

# Start Next.js frontend (PORT defaults to 10000 — Railway / local compose
# override as needed).
npx next start --port ${PORT:-10000} &
NEXT_PID=$!

# Wait for either process to exit; then figure out which one.
# set +e for wait -n; exit code captured explicitly into EXIT_CODE. The
# subsequent `kill -0` / `echo` calls run without errexit — that is fine
# because the final `exit "$EXIT_CODE"` uses the captured value, so the
# container exits with the dying child's status regardless. Restoration of
# `set -e` is intentionally omitted.
set +e
wait -n
EXIT_CODE=$?

# Interpret common exit codes for operators reading the log stream.
# 0   = clean exit (shouldn't happen under `wait -n` when both are servers)
# 127 = command-not-found (bad PATH / missing binary)
# 137 = SIGKILL (usually OOM-killed by the cgroup / Railway / Docker)
# 143 = SIGTERM (orderly shutdown signal from the platform)
case "$EXIT_CODE" in
    0)   EXIT_MEANING="clean exit (unexpected for a long-running server)" ;;
    127) EXIT_MEANING="command not found (missing binary / bad PATH)" ;;
    137) EXIT_MEANING="SIGKILL (likely OOM-killed or force-stopped)" ;;
    143) EXIT_MEANING="SIGTERM (orderly shutdown from platform)" ;;
    *)   EXIT_MEANING="(no common interpretation)" ;;
esac

# `kill -0 <pid>` returns 0 if the process is still alive, nonzero if it is
# gone. Whichever one is gone is the one that died; log both statuses so the
# platform's log stream carries enough info to diagnose.
if ! kill -0 "$AGENT_PID" 2>/dev/null; then
    echo "[entrypoint] agent backend (uvicorn, pid=$AGENT_PID) exited with code $EXIT_CODE — $EXIT_MEANING" >&2
elif ! kill -0 "$NEXT_PID" 2>/dev/null; then
    echo "[entrypoint] next.js frontend (pid=$NEXT_PID) exited with code $EXIT_CODE — $EXIT_MEANING" >&2
else
    # Both still running somehow — wait -n returned but both pids are alive.
    # This should not happen, but report it instead of silently exiting.
    echo "[entrypoint] wait -n returned exit=$EXIT_CODE ($EXIT_MEANING) but both agent ($AGENT_PID) and next.js ($NEXT_PID) appear alive" >&2
fi

exit "$EXIT_CODE"
