# In-Chat Booking (HITL)

Frontend `useHumanInTheLoop` flow. The agent calls `book_call(topic, attendee)`,
the chat renders an inline time-picker card, and the user's selection is
piped back as the tool result.

- Frontend tool registration: `useHumanInTheLoop({ name: "book_call", ... })`
- Picker UI: `time-picker-card.tsx` (slot grid + cancel)
- Agent: built-in agent in `src/lib/factory/tanstack-factory.ts` — no
  backend definition needed; the frontend tool is auto-bridged.
