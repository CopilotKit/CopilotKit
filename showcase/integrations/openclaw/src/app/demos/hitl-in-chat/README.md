# Human in the Loop (In-Chat)

## What This Demo Shows

A human-in-the-loop flow rendered INSIDE the chat. When the agent decides to
book a call, it calls a tool whose UI is a time-picker card; the user's choice
is returned to the agent to continue the run.

- **In-Chat Interaction**: The `book_call` tool renders a `TimePickerCard`
  directly in the message thread
- **User Choice Round-Trips**: The picked slot (or a cancellation) is forwarded
  back to the agent as the tool result
- **Always-Future Slots**: Candidate slots are generated relative to "now" so
  they never go stale

## How to Interact

Ask the agent to schedule something, then pick a slot in the card:

- "Please book an intro call with the sales team to discuss pricing"
- "Schedule a 1:1 with Alice next week to review Q2 goals"

## Technical Details

**Provider** — `CopilotKit` with `runtimeUrl="/api/copilotkit"` (proxying via an
`HttpAgent` to the clawg-ui AG-UI operator route on the OpenClaw gateway) and
`agent="hitl-in-chat"`.

**HITL tool** — `useHumanInTheLoop` registers `book_call` with a Zod schema and
a `render` that returns the `TimePickerCard`; `respond` sends the choice back.

**Steering** — `useAgentContext` supplies per-demo operating instructions
("call `book_call` when asked to schedule; never confirm a time in the past").
The clawg-ui adapter delivers this via AG-UI `context[]`, appending it to the
OpenClaw agent prompt. Slots are memoized once relative to the current time.
