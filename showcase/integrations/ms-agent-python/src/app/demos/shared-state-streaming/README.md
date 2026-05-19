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

The magic is one middleware entry:

```py
StateStreamingMiddleware(
    StateItem(
        state_key="document",
        tool="write_document",
        tool_argument="content",
    )
)
```

Without it, `state.document` would only update when the tool call finishes. With it, every token the LLM generates for the `content` argument is mirrored into state immediately. On the frontend, `useAgent({ updates: [OnStateChanged, OnRunStatusChanged] })` drives re-renders for both the text and the "LIVE" badge; `agent.isRunning` toggles the cursor.
