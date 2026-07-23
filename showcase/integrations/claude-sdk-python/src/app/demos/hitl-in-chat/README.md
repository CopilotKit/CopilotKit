# In-Chat HITL (Booking)

Inline approval/decision UI rendered directly in the chat via the high-level
`useHumanInTheLoop` hook. The `book_call` tool is FRONTEND-DEFINED — the
backend agent (`src/agents/hitl_in_chat_agent.py`) is a basic Claude Agent
SDK chat loop that just forwards AG-UI's frontend-tool definitions to Claude
and lets the standard tool-call lifecycle resolve the user's choice.

There is no backend interrupt: the frontend renders `TimePickerCard` while
the tool is "executing", and `respond(...)` returns the picked slot back to
the agent the same way any other tool result would.
