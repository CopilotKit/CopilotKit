# Headless Interrupt (Strategy B — Promise-Based)

Out-of-chat time-picker popup driven by `useFrontendTool` with an async
handler. The popup appears in the app surface (left pane), outside the chat.
Picking a slot resolves the tool call and the agent confirms in chat.

## How It Works

1. User asks to schedule a meeting via the chat (right pane)
2. Backend scheduling agent calls `schedule_meeting` (a frontend tool)
3. Frontend renders a `TimeSlotPopup` in the app surface (left pane)
4. User picks a slot or cancels
5. The Promise resolves, popup vanishes, agent confirms in chat

## Backend

Shares the same scheduling agent as `gen-ui-interrupt` — the only difference
is the frontend UX (external popup vs. inline chat card).

## Reference

- [ms-agent-python `interrupt-headless`](../../../../../ms-agent-python/src/app/demos/interrupt-headless) — the reference implementation.
- [langgraph-python `interrupt-headless`](../../../../../langgraph-python/src/app/demos/interrupt-headless) — the canonical LangGraph version.
