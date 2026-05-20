# Generative UI Interrupt -- Strategy B (CrewAI Crews)

CrewAI Crews has no equivalent to LangGraph's `interrupt()` primitive, so this
demo adapts the interrupt UX via **Strategy B**: the backend crew defines a
scheduling agent whose system prompt instructs it to call `schedule_meeting`,
and the frontend registers that tool via `useFrontendTool` with an async
handler. The handler renders a time-picker card inline in the chat and returns
a Promise that only resolves once the user picks a slot (or cancels) --
producing the same UX as the LangGraph native interrupt, just with different
plumbing.

Reference: `showcase/integrations/langgraph-python/src/app/demos/gen-ui-interrupt`
