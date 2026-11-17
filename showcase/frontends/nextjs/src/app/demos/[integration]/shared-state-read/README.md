# Shared State (Reading)

## What This Demo Shows

The UI owns a recipe, and the agent reads it on every turn. The agent has no tool that writes the recipe.

- **UI to agent**: every edit in the recipe card goes into `agent.state.recipe` through `agent.setState(...)`.
- **Agent reads**: the agent gets the current recipe as part of its state on every run.
- **Run from the UI**: the "Improve with AI" button adds a user message and starts a run with `copilotkit.runAgent(...)`.

## How to Interact

1. Edit the recipe: the title, the skill level, or the ingredients.
2. Ask the agent in the sidebar: "What recipe am I making?"
3. Read the reply. It names the values that you entered.

## Technical Details

- `useAgent({ agentId: "shared-state-read", updates: [OnStateChanged, OnRunStatusChanged] })` gives the page the agent. The page renders again when the state or the run status changes.
- On mount, the page writes `INITIAL_RECIPE` into the agent state. The effect depends on `agent`, because `useAgent` replaces a provisional agent with the real agent after the runtime connects.
- `types.ts` holds the recipe shape that the UI and the agent share.
