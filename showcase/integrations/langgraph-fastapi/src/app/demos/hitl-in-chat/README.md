# In-Chat HITL (useHumanInTheLoop)

## What This Demo Shows

Interactive booking surface rendered inline in the chat — the agent calls a frontend-only `book_call` tool, and the user picks a time slot from a card embedded in the conversation.

## How to Interact

Ask the assistant to "Book a call with sales" or "Schedule a 1:1 with Alice next week". A time-picker card appears inline; pick a slot (or cancel) and the choice is returned to the agent.

## Technical Details

- Uses the high-level `useHumanInTheLoop` hook (CopilotKit v2) to declare the `book_call` tool entirely on the frontend with a Zod schema and a `render` callback.
- The langgraph-fastapi backend agent (`hitl_in_chat_agent.py`) has zero backend tools — `CopilotKitMiddleware` injects the frontend-registered tool into the LLM's tool list at runtime.
- The `respond` callback resolves the pending tool call with the user's choice, and the agent continues from there.
