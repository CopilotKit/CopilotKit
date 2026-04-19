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
# See also: simple_after_model_modifier in src/agents/main.py which carries a
# redundant partial-event guard. Both layers are intentional.
export ADK_DISABLE_PROGRESSIVE_SSE_STREAMING=1

# Warn (don't fail) when OPENAI_API_KEY is missing — generate_a2ui depends on
# it; other demos in this container do not. Missing the key here means L4
# smoke tests that exercise A2UI generation will fail.
if [ -z "${OPENAI_API_KEY:-}" ]; then
    echo "[entrypoint] WARN: OPENAI_API_KEY not set — generate_a2ui / L4 smoke tests will fail" >&2
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
set +e
wait -n
EXIT_CODE=$?

# `kill -0 <pid>` returns 0 if the process is still alive, nonzero if it is
# gone. Whichever one is gone is the one that died; log both statuses so the
# platform's log stream carries enough info to diagnose.
if ! kill -0 "$AGENT_PID" 2>/dev/null; then
    echo "[entrypoint] agent backend (uvicorn, pid=$AGENT_PID) exited with code $EXIT_CODE" >&2
elif ! kill -0 "$NEXT_PID" 2>/dev/null; then
    echo "[entrypoint] next.js frontend (pid=$NEXT_PID) exited with code $EXIT_CODE" >&2
else
    # Both still running somehow — wait -n returned but both pids are alive.
    # This should not happen, but report it instead of silently exiting.
    echo "[entrypoint] wait -n returned exit=$EXIT_CODE but both agent ($AGENT_PID) and next.js ($NEXT_PID) appear alive" >&2
fi

exit "$EXIT_CODE"
