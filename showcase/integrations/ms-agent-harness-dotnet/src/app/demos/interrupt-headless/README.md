# Interrupt Headless (MS Agent Framework adaptation)

## What this demo shows

A scheduling interaction driven from a button grid **outside the chat** (a
popup in the app surface). The chat triggers the agent; when the agent needs
the user to pick a time, the popup appears in the app surface, not in the
chat. Picking a slot resolves the pending tool call and the agent replies.

## Adaptation note

The LangGraph version of this demo uses a custom `useHeadlessInterrupt` hook
that listens for LangGraph's native `interrupt()` event on the AG-UI stream
and resumes via `copilotkit.runAgent({ forwardedProps: { command: { resume } } })`.
Microsoft Agent Framework has no interrupt primitive, so this port is
**adapted**:

- The backend agent (`src/agents/interrupt_agent.py`) is prompted to call
  `schedule_meeting` by name.
- The frontend registers `schedule_meeting` via `useFrontendTool`. The async
  handler sets the `pending` payload (making the popup render in the left
  pane) and then returns a Promise that only resolves once the user clicks a
  slot or cancels in the popup. `render` returns `null` so nothing appears
  inside the chat itself.

The user-visible UX is equivalent to the LangGraph version. The underlying
mechanism differs.

## Related

- Backend agent: `src/agents/interrupt_agent.py` (shared with `gen-ui-interrupt`)
- HTTP mount: `/interrupt-adapted` in `src/agent_server.py`
- Sibling demo: `src/app/demos/gen-ui-interrupt` (inline-in-chat picker)
