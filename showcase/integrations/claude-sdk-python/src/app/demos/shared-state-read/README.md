# Shared State (Reading)

## What This Demo Shows

Reading agent state from UI

## How to Interact

Try asking your Copilot to:

- "What tasks are on my todo list?"
- "Summarize what I have to do"
- "How many items are pending?"

The agent reads the shared application state (todo list) and responds based on the current data.

## Technical Details

- **Shared state** lets the agent read the same state the frontend manages via `useAgent().state`
- The UI is the single source of truth: the page seeds and edits `state.recipe` through `agent.setState(...)`, and the Claude backend reads that recipe out of the incoming run on every turn
- The agent only READS the shared state (no tools mutate it), so no backend `STATE_SNAPSHOT` events are emitted — the round-trip is UI → runtime → agent
- This enables the agent to answer questions about the current UI state without the frontend sending it as context
