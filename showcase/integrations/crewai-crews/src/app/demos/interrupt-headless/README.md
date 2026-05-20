# Headless Interrupt -- Strategy B (CrewAI Crews)

CrewAI Crews has no equivalent to LangGraph's `interrupt()` primitive, so this
demo adapts the headless interrupt UX via **Strategy B**: the backend crew
defines a scheduling agent whose system prompt instructs it to call
`schedule_meeting`, and the frontend registers that tool via `useFrontendTool`
with an async handler. The handler shows a time-picker popup in the app surface
(outside the chat) and returns a Promise that only resolves once the user picks
a slot (or cancels) -- producing the same headless UX as the LangGraph
reference, just with different plumbing.

Reference: `showcase/integrations/langgraph-python/src/app/demos/interrupt-headless`
