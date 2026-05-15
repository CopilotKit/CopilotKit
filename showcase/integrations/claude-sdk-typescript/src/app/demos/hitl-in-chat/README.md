# In-Chat Human in the Loop

## What This Demo Shows

The agent pauses inline in the chat to ask the user to pick a time slot via
`useHumanInTheLoop`. The frontend renders a `TimePickerCard` with fixed
candidate slots; the user's choice is returned to the agent which then
confirms the booking.

## How to Interact

- "Please book an intro call with the sales team to discuss pricing."
- "Schedule a 1:1 with Alice next week."

## Technical Details

- Frontend tool: `useHumanInTheLoop({ name: "book_call", parameters, render })`.
- The Claude SDK backend is a pass-through — Claude sees the tool definition
  forwarded by the runtime and emits a `tool_use` for `book_call`. The
  frontend renders the picker, captures the user's pick, and returns the
  result back into the conversation.
- Card: `./time-picker-card.tsx`.
