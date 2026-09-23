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
- The agent's tools access `runtime.state` to query current application data
- State is defined as a typed schema (`AgentState`) shared between frontend and backend
- This enables the agent to answer questions about the current UI state without the frontend sending it as context
