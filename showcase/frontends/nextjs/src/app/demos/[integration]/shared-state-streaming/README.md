# State Streaming

## What This Demo Shows

The agent writes a document into shared state while its tool call is still in flight. The document panel grows token by token.

- **Live document panel**: the panel renders `state.document` with a blinking cursor and a "LIVE" badge.
- **Token-level updates**: the backend copies each streamed token of the `write_document` tool argument into the `document` state key.
- **Character count**: a running count makes the stream easy to see.

## How to Interact

1. Click a suggestion, or ask: "Write a short poem about autumn leaves."
2. Look at the document panel. The text grows while the agent writes.

## Technical Details

- `useAgent({ updates: [OnStateChanged, OnRunStatusChanged] })` renders the page again for each state update and each run-status change. `agent.isRunning` controls the cursor and the "LIVE" badge.
- Without token streaming on the backend, `state.document` changes only once, when the tool call ends.
- Some backends cannot stream a tool argument token by token. Such an integration sets `unsupportedNotice` in `src/integrations/<slug>/demos/shared-state-streaming.ts`, and the empty panel shows that notice. `page.tsx` reads this setting on the server and passes it to `demo.tsx`.
