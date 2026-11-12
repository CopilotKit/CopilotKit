# State Streaming

## What This Demo Shows

Per-token streaming of a tool argument directly into shared agent state — the document grows character-by-character in the UI while the tool call is still in flight.

- **Live document panel**: `state.document` is rendered in a document view with a blinking cursor and a "LIVE" badge
- **Token-level deltas**: every streamed token from the agent's `write_document` tool argument is forwarded straight into the `document` state key
- **Char counter**: a running character count makes the per-token stream obvious

## How to Interact

Click a suggestion chip, or try:

- "Write a short poem about autumn leaves."
- "Draft a polite email declining a meeting next Tuesday afternoon."
- "Write a 2-paragraph explanation of quantum computing for a curious teenager."

Watch the document panel fill in live as the agent writes.

## Technical Details

The route is served by `DocumentStreamingAgent`
(`src/demo_agents/shared_state_streaming.py`), the adapter's
`OpenAIAgentsAgent` with one addition: it follows the `TOOL_CALL_ARGS` deltas
of a `write_document` call and, after each one, sends the `document`
argument's text so far as a `STATE_DELTA` on `/document`. Without it,
`state.document` would only update when the tool body runs and commits the
final text with `shared_state().update(document=...)`. On the frontend,
`useAgent({ updates: [OnStateChanged, OnRunStatusChanged] })` drives
re-renders for both the text and the "LIVE" badge; `agent.isRunning` toggles
the cursor.
