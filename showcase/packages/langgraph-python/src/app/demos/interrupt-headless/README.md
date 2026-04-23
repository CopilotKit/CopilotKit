# Headless Interrupt (testing)

## What This Demo Shows

The same `schedule_meeting` interrupt flow as `gen-ui-interrupt`, but the picker UI is rendered in the app surface (left pane) rather than inline in chat — built directly on the agent subscription primitives with no `useInterrupt` hook.

- **Split layout**: chat on the right, dedicated "Scheduling" app surface on the left
- **App-level picker**: when the backend calls `interrupt(...)`, a time-picker popup appears in the left pane, not in the chat
- **Hand-rolled handshake**: a local `useHeadlessInterrupt` hook subscribes to the agent's custom events and resumes the run with `copilotkit.runAgent({ forwardedProps: { command: { resume, interruptEvent } } })`

## How to Interact

Click a suggestion chip, or type your own prompt. For example:

- "Book an intro call with the sales team to discuss pricing"
- "Schedule a 1:1 with Alice next week to review Q2 goals"

The picker pops up in the left pane; picking a slot resumes the agent, which confirms back in chat.

## Technical Details

- `useAgent({ agentId })` + `agent.subscribe({ onCustomEvent, onRunStartedEvent, onRunFinalized, onRunFailed })` captures the `on_interrupt` event and exposes it as `pending`
- `resolve(response)` calls `copilotkit.runAgent({ agent, forwardedProps: { command: { resume: response, interruptEvent: snapshot.value } } })` to resume the paused graph
- The backend agent is shared with `gen-ui-interrupt` (`src/agents/interrupt_agent.py`) — only the frontend changes; this demo exists mainly to exercise the low-level subscription API in tests
- Uses `agent="interrupt-headless"` and `useConfigureSuggestions` for starter prompts
