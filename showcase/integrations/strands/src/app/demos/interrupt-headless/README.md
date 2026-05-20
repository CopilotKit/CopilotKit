# interrupt-headless (Strands — Strategy B)

Headless interrupt demo: chat on the right, app surface on the left. When the
agent calls `schedule_meeting`, a time-picker popup appears in the app surface
(outside the chat). Picking a slot resolves the tool call.

This is the Strands adaptation of the LangGraph headless interrupt demo. Since
Strands does not have a native interrupt primitive, we use the "Strategy B"
pattern: `useFrontendTool` with an async handler that sets pending state for
the external popup and returns a Promise that resolves when the user interacts.

## Files

- `page.tsx` — demo page with split layout and external popup
