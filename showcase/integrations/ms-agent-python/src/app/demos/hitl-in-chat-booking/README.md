# In-Chat HITL — Booking Flow

## What This Demo Shows

A booking-flavored alias of the in-chat HITL pattern: the agent calls a
frontend-defined `book_call` tool, the time-picker card renders inline,
and the user's chosen slot is returned to the agent.

## How to Interact

Try asking your Copilot to:

- "Book an intro call with the sales team."
- "Schedule an onboarding session for next week."

A time-picker card appears in the chat. Pick a slot (or cancel) and the
agent confirms.

## Technical Details

Same wiring as `hitl-in-chat`: the `book_call` tool is registered via
`useHumanInTheLoop`; the MS Agent Framework agent has `tools=[]` and runs
on the same `/hitl-in-chat` FastAPI endpoint. The booking-flow alias
reuses the time-picker component from `../hitl-in-chat/time-picker-card.tsx`.
