# Gen UI Interrupt (Strategy B — Promise-Based)

Inline time-picker rendered in the chat via `useFrontendTool` with an async
handler. The handler returns a Promise that resolves only when the user picks a
slot or cancels — equivalent UX to LangGraph's native `interrupt()` primitive,
adapted for the Claude Agent SDK which has no graph-level pause/resume.

## How It Works

1. User asks to book a meeting
2. Backend scheduling agent calls `schedule_meeting` (a frontend tool)
3. Frontend renders `TimePickerCard` inline in the chat
4. User picks a slot or cancels
5. The Promise resolves with the result, which flows back to the agent
6. Agent confirms the booking in chat

## Backend

The Python backend at `src/agents/interrupt_agent.py` defines only a system
prompt and `tools=[]` — the `schedule_meeting` tool is registered entirely on
the frontend. AG-UI forwards the frontend tool definition to Claude, and the
tool call lifecycle resolves the user's choice back through CopilotKit.

## Reference

- [ms-agent-python `gen-ui-interrupt`](../../../../../ms-agent-python/src/app/demos/gen-ui-interrupt) — the reference implementation this port is based on.
- [langgraph-python `gen-ui-interrupt`](../../../../../langgraph-python/src/app/demos/gen-ui-interrupt) — the canonical LangGraph version using native `interrupt()`.
