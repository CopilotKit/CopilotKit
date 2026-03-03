# Shared State

Patterns for app/agent state synchronization and control.

## Guidance
### Shared State
- Route: `/shared-state`
- Source: `docs/content/docs/(root)/shared-state.mdx`
- Description: Create a two-way connection between your UI and agent state.

This video demonstrates the Research Canvas utilizing shared state.

## What is shared state?

Agentic Copilots maintain a shared state that seamlessly connects your UI with the agent's execution. This shared state system allows you to:

- Display the agent's current progress and intermediate results
- Update the agent's state through UI interactions
- React to state changes in real-time across your application

## Choose your Integration

Shared State can be implemented with any agentic backend, with each integration providing different approaches for creating bidirectional data flow between your application and AI agents.

**Choose your integration to see specific implementation guides and examples.**

## When should I use this?

Shared state is perfect when you want to facilitate collaboration between your agent and the user. Updates to the outputs will be automatically shared by the UI. Similarly, any `inputs` that the user updates in the UI will be automatically reflected in the crews execution.

This allows for a consistent experience where both the agent and the user are on the same page.
