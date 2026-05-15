# gen-ui-interrupt (Strands — Strategy B)

Interactive time-picker card rendered inline in the chat via `useFrontendTool`
with an async handler. The handler returns a Promise that only resolves once
the user picks a slot (or cancels), blocking the agent's tool call until the
user decides.

This is the Strands adaptation of the LangGraph `useInterrupt` demo. Since
Strands does not have a native interrupt primitive, we use the "Strategy B"
pattern: the backend's shared agent has a `schedule_meeting` tool, and the
frontend overrides it with `useFrontendTool` to implement the blocking
picker UX.

## Files

- `page.tsx` — demo page with `useFrontendTool` async handler
- `time-picker-card.tsx` — time slot picker component
