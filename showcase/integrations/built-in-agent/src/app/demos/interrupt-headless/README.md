# Headless Interrupt — Built-in Agent (Strategy B: Frontend Tool)

Headless time-picker popup rendered outside the chat in the app surface.
Same mechanism as `gen-ui-interrupt` but the picker is an external popup,
not an inline chat card.

The frontend registers `schedule_meeting` via `useFrontendTool` with an
async handler. The handler sets a pending state to render the external
popup, then returns a Promise that resolves when the user picks a slot.
The `render` callback returns null so nothing appears inline in the chat.

See the `langgraph-python` integration for the native interrupt-based
implementation.
