# In-Chat Human in the Loop (useHumanInTheLoop)

## What This Demo Shows

Inline approval/decision UI rendered directly inside the chat via the
high-level `useHumanInTheLoop` hook — the agent calls a frontend-defined
`book_call` tool, the picker UI renders inline, and the user's choice is
returned to the agent.

## How to Interact

Try asking your Copilot to:

- "Please book an intro call with the sales team."
- "Schedule a 1:1 with Alice next week to review Q2 goals."

A time-picker card appears in the chat. Pick a slot (or cancel) and the
agent confirms the result.

## Technical Details

- The `book_call` tool is defined entirely on the frontend via
  `useHumanInTheLoop`; the MS Agent Framework agent has `tools=[]` and just
  calls the tool by name.
- CopilotKit forwards the user's chosen slot (or `{ cancelled: true }`) back
  to the agent as the tool result, which the agent reflects in its
  follow-up message.
