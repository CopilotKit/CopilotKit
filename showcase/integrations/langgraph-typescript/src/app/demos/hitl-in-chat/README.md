# In-Chat HITL (useHumanInTheLoop)

Demonstrates the high-level `useHumanInTheLoop` hook for inline approval/decision UI in the chat surface.

The frontend registers a `book_call` HITL tool whose render prop returns a time-picker card. The agent (`src/agent/hitl-in-chat.ts`) calls the tool; the user's selection is forwarded back to the agent via the `respond` callback.

Mirrors the booking flow: the same files also back the `hitl-in-chat-booking` demo.
