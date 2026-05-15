# Headless Interrupt — Not Supported on Agno

## Why this demo is stubbed

The canonical LangGraph version of `interrupt-headless` drives a picker
UI rendered OUTSIDE the chat (in the app surface) using a custom
`useHeadlessInterrupt` hook on top of `useAgent` + `useCopilotKit`. The
hook reads LangGraph's native `interrupt()` event from the AG-UI stream
and resumes the run via
`copilotkit.runAgent({ forwardedProps: { command: { resume, ... } } })`.

Agno has no equivalent graph-level interrupt primitive. An Agno agent
runs to completion on each invocation, and there is no pause / resume
API that can carry client-supplied state across a suspension. The demo
is therefore documented and stubbed here rather than ported.

## What to use instead on Agno

For "agent blocks on user input rendered as a modal OUTSIDE the chat",
use Agno's `hitl-in-app` demo. It registers an async `useFrontendTool`
whose handler returns a Promise that only resolves once the user
interacts with a host-rendered modal — equivalent UX, different
underlying mechanism.

## Related

- Canonical implementation:
  `showcase/integrations/langgraph-python/src/app/demos/interrupt-headless`
- Closest Agno-supported pattern:
  `src/app/demos/hitl-in-app` (in this integration)
- Manifest entry: `not_supported_features` in `showcase/integrations/agno/manifest.yaml`
