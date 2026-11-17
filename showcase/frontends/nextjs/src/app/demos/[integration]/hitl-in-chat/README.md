# In-Chat Human in the Loop

## What This Demo Shows

The agent asks you to pick a time for a call, inside the chat.

- **Time picker in the chat**: when the agent calls the `book_call` tool, a card with four candidate slots renders in the chat.
- **Your answer goes back to the agent**: the slot that you pick, or your cancel, is the tool result. The agent then confirms in chat.

## How to Interact

Click a suggestion, or ask the agent to book a call. For example:

- "Please book an intro call with the sales team to discuss pricing."
- "Schedule a 1:1 with Alice next week to review Q2 goals."

Pick a slot to book it. To cancel, click **None of these work**.

## Technical Details

- `useHumanInTheLoop` registers the `book_call` tool on the frontend. The agent needs no tool of its own.
- The `render` function shows `TimePickerCard`. The card calls `respond({ chosen_time, chosen_label })` or `respond({ cancelled: true })`.
- The card buttons work only while the tool call has the `executing` status.
- The candidate slots come from `generateFallbackSlots()` in `../_shared/interrupt-fallback-slots.ts`. They are tomorrow and next Monday, counted from the time that the page loads.

`CopilotKit` connects the page to the runtime:

- `runtimeUrl` is `/api/<integration>/hitl-in-chat`. `useDemoRuntimeUrl("hitl-in-chat")` makes it from the `[integration]` segment of the page URL.
- `agent="hitl-in-chat"` selects the agent that `src/integrations/<integration>/agents.ts` registers for this demo.
