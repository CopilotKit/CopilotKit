# In-Chat Human in the Loop (book_call)

## What This Demo Shows

Frontend-tool HITL via `useHumanInTheLoop` — the agent calls a `book_call`
tool, the frontend renders a time-picker card inside the chat, and the
user's chosen slot is forwarded back to the agent as the tool result.

## How to Interact

Try asking your Copilot to:

- "Book an intro call with sales"
- "Schedule a 1:1 with Alice next week"
- "Set up a 30-minute call with the customer success team"

The agent calls `book_call` with a short topic and attendee. The frontend
renders a card listing four candidate time slots; pick one to book, or
"None of these work" to cancel. The picked slot (or cancellation) is
returned to the agent, which confirms the outcome in chat.

## Technical Details

- The `book_call` tool is defined entirely on the frontend via
  `useHumanInTheLoop({ name, parameters, render })`. The ADK backend has
  NO matching tool — the ag-ui-adk middleware injects the frontend tool
  list at request time, the agent picks `book_call`, and the rendered
  card calls `respond({...})` with the user's selection.
- `respond({ chosen_time, chosen_label })` returns a structured result;
  `respond({ cancelled: true })` signals user cancellation. The agent
  reads the structured response and replies in plain text.
- This is the canonical "agent asks user a structured question" pattern
  for ADK — no `interrupt()` primitive needed because the chat-side tool
  lifecycle (`inProgress` → `executing` → `complete`) already encodes
  the pause-and-resume semantics.

## Building With This

The `TimePickerCard` uses Tailwind classes to match the langgraph-python
reference 1:1; Tailwind v4's automatic source-file scanning picks them up
inside CopilotKit's chat tree. See the
[Styling Guide](https://github.com/CopilotKit/CopilotKit/blob/main/showcase/STYLING-GUIDE.md)
for the rare cases where inline styles are still needed (dynamically
generated class names from props/state).
