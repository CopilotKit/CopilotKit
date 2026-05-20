# In-Chat HITL (useHumanInTheLoop)

Inline approval/decision surface rendered directly in the chat via the
high-level `useHumanInTheLoop` hook. The `book_call` tool is defined on
the FRONTEND with a Zod schema and a custom `TimePickerCard` renderer —
no backend interrupt logic is needed.

The PydanticAI agent (`src/agents/hitl_in_chat_agent.py`) is a plain
chat agent with an empty tool list; the AG-UI bridge surfaces the
frontend-registered `book_call` tool to the model on each run. The
user's selection flows back as a tool result, and the agent acknowledges
the booking with one short sentence.
