# In-Chat HITL (useInterrupt — low-level primitive)

## What This Demo Shows

The same in-chat time-picker flow as the `useHumanInTheLoop` demo, but built on the lower-level `useInterrupt` primitive driven by LangGraph's native `interrupt()` call.

- **Backend-driven pause**: the Python tool `schedule_meeting` calls `interrupt({topic, attendee})` to suspend the graph run
- **Frontend renders the pause**: `useInterrupt` receives the event and renders a `TimePickerCard` in chat
- **Resume with a value**: `resolve(...)` sends the user's choice back into the graph, which the tool reads as its `interrupt()` return value

## How to Interact

Click a suggestion chip, or type your own prompt. For example:

- "Book an intro call with the sales team to discuss pricing"
- "Schedule a 1:1 with Alice next week to review Q2 goals"
- "Set up a meeting with engineering for Monday"

## Technical Details

- Backend tool uses `from langgraph.types import interrupt`; `response = interrupt({"topic": topic, "attendee": attendee})` pauses the run until the frontend resumes it
- Frontend wires `useInterrupt({ agentId, renderInChat: true, render: ({ event, resolve }) => ... })` — `event.value` carries the payload from `interrupt(...)` and `resolve(result)` becomes the tool's return value
- Unlike `useHumanInTheLoop` (which defines a whole tool on the frontend), `useInterrupt` only handles the pause/resume handshake for a backend tool that already exists
- `CopilotKit` provider uses `agent="gen-ui-interrupt"`, backed by `src/agents/interrupt_agent.py`
