# Gen UI Interrupt (MS Agent Framework adaptation)

## What this demo shows

An interactive component (a time-picker card) rendered **inline in the chat**
as the agent is running, driving the agent's next step from the user's choice.

## Adaptation note

The LangGraph version of this demo uses `useInterrupt` backed by LangGraph's
native `interrupt()` primitive (checkpoint/resume on the backend). Microsoft
Agent Framework does **not** expose an interrupt primitive, so this port is
**adapted**:

- The backend agent (`src/agents/interrupt_agent.py`) has **no** local
  `schedule_meeting` implementation. It is prompted to call `schedule_meeting`
  by name.
- The frontend registers `schedule_meeting` via `useFrontendTool` with an
  **async handler** that returns a Promise. The Promise only resolves when the
  user picks a slot (or cancels) on the rendered `TimePickerCard`. That is the
  MS Agent shim for LangGraph's `resolve(...)` callback.

The user-visible UX is equivalent to the LangGraph version. The underlying
mechanism differs.

## Related

- Backend agent: `src/agents/interrupt_agent.py`
- HTTP mount: `/interrupt-adapted` in `src/agent_server.py`
- Sibling demo: `src/app/demos/interrupt-headless` (same backend, external popup)
