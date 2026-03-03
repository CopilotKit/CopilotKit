# Shared State

Patterns for app/agent state synchronization and control.

## Guidance
### Shared State
- Route: `/shared-state`
- Source: `docs/content/docs/(root)/shared-state.mdx`
- Description: Create a two-way connection between your UI and agent state.

## What is shared state?

Agentic Copilots maintain a shared state that seamlessly connects your UI with the agent's execution. This shared state system allows you to:

- Display the agent's current progress and intermediate results
- Update the agent's state through UI interactions
- React to state changes in real-time across your application

## When should I use this?

Use shared state when you want to facilitate collaboration between your agent and the user. Updates flow both ways — the agent's outputs are automatically reflected in the UI, and any inputs the user updates in the UI are automatically reflected in the agent's execution.

## Get started by choosing your AI backend
