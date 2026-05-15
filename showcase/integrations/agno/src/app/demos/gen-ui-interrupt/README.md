# Gen UI Interrupt — Not Supported on Agno

## Why this demo is stubbed

The canonical LangGraph version of `gen-ui-interrupt` uses LangGraph's
graph-level `interrupt()` primitive together with the frontend
`useInterrupt` hook:

1. Inside a node, the graph calls `interrupt({...payload})` and pauses.
2. The frontend `useInterrupt` hook renders a card inside the chat from
   the surfaced payload.
3. When the user picks a slot, the frontend resumes the run via
   `copilotkit.runAgent({ forwardedProps: { command: { resume } } })`,
   carrying the user-supplied value back into the paused node.

Agno has no equivalent graph-level interrupt primitive. An Agno agent
runs to completion on each invocation, and there is no pause / resume API
that can carry client-supplied state across a suspension. The demo is
therefore documented and stubbed here rather than ported.

## What to use instead on Agno

For "agent blocks on user confirmation before proceeding", use Agno's
`hitl-in-chat` demo (`useHumanInTheLoop`), which renders a card inside
the chat and waits for the user to act. The user-visible UX is similar
even though the underlying mechanism differs.

## Related

- Canonical implementation:
  `showcase/integrations/langgraph-python/src/app/demos/gen-ui-interrupt`
- Closest Agno-supported pattern:
  `src/app/demos/hitl-in-chat` (in this integration)
- Manifest entry: `not_supported_features` in `showcase/integrations/agno/manifest.yaml`
