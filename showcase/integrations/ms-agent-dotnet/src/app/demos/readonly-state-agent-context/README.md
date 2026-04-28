# Read-Only Agent Context

## What This Demo Shows

`useAgentContext` sends read-only values from the app into the agent's prompt context. The agent sees them on every turn, but cannot modify them — edits flow strictly from UI → agent.

This is the simplest way to give an agent situational awareness (who the user is, what they're doing, what page they're on) without the round-trip complexity of shared state.

## How to Interact

Change the context on the left panel (name, timezone, recent activity), then ask the agent:

- "What do you know about me from my context?"
- "Based on my recent activity, what should I try next?"
- "What time is it in my timezone and what should I do for the next hour?"

The agent's answer reflects the current panel values — change them and ask again to see the difference.

## Technical Details

Each piece of context is registered with `useAgentContext`:

```tsx
useAgentContext({
  description: "The currently logged-in user's display name",
  value: userName,
});
```

Every turn, the registered values are serialized and attached to the request sent to the backend agent. The agent reads them as part of its prompt. There is no setter — the agent has no way to mutate these values.
