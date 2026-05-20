# gen-ui-interrupt — Mastra (Strategy B: Frontend Tool)

**Feature:** In-chat time-picker that blocks the agent until the user picks a
slot or cancels. Produces the same UX as the LangGraph `interrupt()`
primitive, but via `useFrontendTool` with an async handler.

**How it works:** The backend defines a scheduling agent with no tools. The
frontend registers `schedule_meeting` via `useFrontendTool`; the async handler
returns a Promise that only resolves once the user picks a slot. The agent
calls `schedule_meeting` as a regular tool call, which is satisfied entirely
by the frontend.

**LangGraph reference:** see `langgraph-python` — `src/app/demos/gen-ui-interrupt/page.tsx`.
