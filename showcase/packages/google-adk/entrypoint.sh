#!/bin/bash
set -e

# Disable Google ADK's progressive SSE streaming feature. With it enabled,
# Gemini 2.5-flash occasionally returns a stream whose final event is flagged
# `partial`, which the ADK flow aborts with a "The last event is partial"
# warning — the backend then emits no TOOL_CALL_* or TEXT_MESSAGE_* events,
# so the tool-rendering UI is stranded and L4 smoke tests intermittently fail.
# With it OFF the ADK falls back to simple text accumulation and always
# produces a coherent final response.
export ADK_DISABLE_PROGRESSIVE_SSE_STREAMING=1

# Start agent backend
python -m uvicorn agent_server:app --host 0.0.0.0 --port 8000 &

# Start Next.js frontend (PORT defaults to 10000 for Render)
npx next start --port ${PORT:-10000} &

# Wait for either process to exit
wait -n
exit $?
