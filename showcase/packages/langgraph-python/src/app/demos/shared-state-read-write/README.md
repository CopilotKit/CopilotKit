# Shared State (Writing)

## What This Demo Shows

Writing to agent state from UI

## How to Interact

Try asking your Copilot to:

- "Add a task to buy groceries"
- "Mark the first task as completed"
- "Create three tasks for planning a trip"

The agent modifies the shared state directly, and the frontend updates in real-time.

## Technical Details

- **Bidirectional state** — the agent can both read and write the same state the frontend displays
- Agent tools return `Command(update={...})` to modify state, which syncs to the frontend via CopilotKit
- The frontend calls `agent.setState()` for user-driven changes, and both paths update the same source of truth
- This enables true collaborative interaction where user and agent manipulate the same data
