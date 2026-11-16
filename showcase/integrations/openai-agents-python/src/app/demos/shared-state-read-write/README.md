# Shared State (Read + Write)

## What This Demo Shows

Bidirectional shared state between the UI and the agent — both sides read and write the same state object.

- **UI → agent**: a sidebar form (name, tone, language, interests) writes into `state.preferences` via `agent.setState(...)`. The agent's dynamic instructions show the model the current state on every turn.
- **agent → UI**: the agent's `set_notes` tool writes into `state.notes`; the sidebar's notes card re-renders whenever the agent updates it.
- **Round-trip**: editing preferences in the sidebar visibly steers the agent's next reply (tone, language, addressing you by name).

## How to Interact

Edit your preferences in the sidebar first, then try:

- "Say hi and introduce yourself."
- "Remember that I prefer morning meetings and that I don't eat dairy."
- "Suggest a weekend plan based on my interests."

Watch the agent's replies adapt to your preferences, and watch new notes appear in the sidebar as you ask it to remember things.

## Technical Details

- `useAgent({ agentId, updates: [UseAgentUpdate.OnStateChanged] })` subscribes the page to every state mutation from the agent, so `state.notes` changes re-render the sidebar.
- The same `agent.setState({ preferences, notes })` call handles UI writes — editing the form or clicking "Clear" on notes both flow through it.
- On the backend (`src/demo_agents/shared_state.py`), the agent's dynamic instructions append the state the UI sent with the run (preferences and notes) to the prompt before every model call. The `set_notes` function tool writes back with `shared_state().update(notes=notes)`, which streams a `STATE_SNAPSHOT`.
