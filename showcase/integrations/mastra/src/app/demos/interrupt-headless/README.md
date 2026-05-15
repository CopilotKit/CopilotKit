# interrupt-headless — Mastra (Strategy B: Frontend Tool)

**Feature:** Headless time-picker popup rendered outside the chat in the app
surface. Blocks the agent until the user picks a slot or cancels. Same
mechanism as `gen-ui-interrupt` but the picker is an external popup, not an
inline chat card.

**How it works:** The backend defines a scheduling agent with no tools. The
frontend registers `schedule_meeting` via `useFrontendTool`; the async handler
sets a `pending` state to render the external popup, then returns a Promise
that resolves when the user picks a slot. The `render` callback returns null
so nothing appears inline in the chat.

**LangGraph reference:** see `langgraph-python` — `src/app/demos/interrupt-headless/page.tsx`.
