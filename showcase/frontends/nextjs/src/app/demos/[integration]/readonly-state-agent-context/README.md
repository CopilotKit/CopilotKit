# Read-Only Agent Context

## What This Demo Shows

`useAgentContext` sends read-only values from the app into the agent's prompt context. The agent sees them on every turn, but it cannot change them. Values go one way only, from the UI to the agent.

This is the simplest way to tell an agent who the user is and what they do in the app, without shared state.

## How to Interact

1. Edit the context in the left panel: the name, the timezone, or the recent activity.
2. In the chat popup, ask: "What do you know about me from my context?"
3. Change a value, then ask again. The reply uses the new value.

## Technical Details

Each piece of context is registered with `useAgentContext`:

```tsx
useAgentContext({
  description: "The currently logged-in user's display name",
  value: userName,
});
```

On every turn, CopilotKit serializes the registered values and attaches them to the request to the backend agent. The agent reads them as part of its prompt. There is no setter, so the agent cannot change these values.
