# In-Chat HITL (useHumanInTheLoop)

## What This Demo Shows

The agent pauses and asks the user to pick a time slot for a call. The
picker UI is rendered inline in the chat via the high-level
`useHumanInTheLoop` hook; the user's choice is returned to the agent as
the tool result.

## How to Interact

Try asking your Copilot to:

- "Book an intro call with the sales team."
- "Schedule a 1:1 with Alice next week."

## Technical Details

- The `book_call` tool is registered entirely on the frontend via
  `useHumanInTheLoop` — no backend tool exists.
- The .NET agent (`HitlInChatAgent`) is a plain `ChatClientAgent` with a
  short system prompt that nudges the model to call `book_call` when the
  user wants to book a call.
- The hook's `render` callback returns the `TimePickerCard`; calling
  `respond` resolves the pending tool with the user's choice.
