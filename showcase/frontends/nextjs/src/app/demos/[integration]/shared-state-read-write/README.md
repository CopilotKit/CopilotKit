# Shared State (Read + Write)

## What This Demo Shows

The UI and the agent read and write the same state object.

- **UI to agent**: the preferences card (name, tone, language, interests) writes `state.preferences` with `agent.setState(...)`. On every turn, the backend adds the preferences to the system prompt.
- **Agent to UI**: the agent's `set_notes` tool writes `state.notes`. The notes card renders again when the notes change.
- **Round trip**: the "Clear" button on the notes card writes an empty list back into `state.notes`.

## How to Interact

1. Enter your name and pick a tone in the preferences card.
2. Ask the agent: "Say hi and introduce yourself." The reply uses your name and tone.
3. Ask the agent: "Remember that I prefer morning meetings." A new note appears in the notes card.
4. Click "Clear" to remove the notes.

## Technical Details

- `useAgent({ agentId: "shared-state-read-write", updates: [UseAgentUpdate.OnStateChanged] })` renders the page again on every state change, so agent writes show at once.
- `agent.setState` replaces the whole state object. Each UI write spreads the current state first, so it keeps the agent's notes and any keys that the runtime owns.
- The backend contract: read `state.preferences` before each model call, and write `state.notes` from a `set_notes` tool.
