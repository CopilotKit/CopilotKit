# Gen UI Interrupt — Built-in Agent (Strategy B: Frontend Tool)

In-chat time-picker that blocks the agent until the user picks a slot or
cancels. Produces the same UX as the LangGraph `interrupt()` primitive, but
via `useFrontendTool` with an async handler.

The built-in agent (TanStack AI) auto-discovers the frontend-registered
`schedule_meeting` tool and calls it as a regular tool call. The async
handler returns a Promise that only resolves once the user picks a slot,
blocking the agent loop until the decision is made.

See the `langgraph-python` integration for the native interrupt-based
implementation.
