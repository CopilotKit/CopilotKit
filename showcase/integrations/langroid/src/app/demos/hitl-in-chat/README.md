# In-Chat HITL (useHumanInTheLoop)

## What This Demo Shows

A high-level human-in-the-loop pattern: the agent calls a frontend-defined
tool (`book_call`), the chat renders a time-picker card, and the user's
selection is returned as the tool result.

## How to Interact

Try asking your Copilot to:

- "Book an intro call with sales to discuss pricing"
- "Schedule a 1:1 with Alice next week"

The agent calls `book_call` with a short topic; the time-picker appears
inline in the chat. Pick a slot (or cancel) and the agent confirms the
booking in a follow-up message.

## Technical Details

- The `book_call` tool is defined ENTIRELY on the frontend via
  `useHumanInTheLoop` — the Langroid backend does not declare it.
- The Langroid agent receives the tool schema from the AG-UI runtime as
  part of the request and the LLM emits a tool call against it.
- `useHumanInTheLoop` registers a `render` that receives `{ args, status,
respond }`; calling `respond({ chosen_time, chosen_label })` resolves
  the pending tool call so the agent can continue the run.

## Notes for Langroid

Langroid does not expose LangGraph's `interrupt()` primitive, so this
demo uses the frontend-tool flavor of HITL (`useHumanInTheLoop` only —
no `useInterrupt`). The lower-level `useInterrupt`-based demos
(`gen-ui-interrupt`, `interrupt-headless`) are not portable to Langroid
without an interrupt-aware adapter.
