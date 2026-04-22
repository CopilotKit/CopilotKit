# State Streaming

## What This Demo Shows

Per-token state delta streaming from agent to UI

## How to Interact

Try asking your Copilot to:

- "Add five tasks for a birthday party"
- "Create a detailed project plan"
- "Generate a week's worth of meal prep tasks"

Watch the todo list update in real-time as the agent streams state changes.

## Technical Details

- **Streaming state** extends shared-state-write by showing intermediate state updates as they happen
- Instead of waiting for the agent to finish, state changes stream to the frontend incrementally
- Each tool call's `Command(update={...})` is emitted as a streaming event
- The frontend re-renders after each state delta, creating a live-updating UI during agent execution
