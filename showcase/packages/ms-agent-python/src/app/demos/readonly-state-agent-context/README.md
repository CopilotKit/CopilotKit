# Read-only State via `useAgentContext`

## What This Demo Shows

The frontend provides **read-only** context to the agent via `useAgentContext`. The agent reads this context on every turn and uses it in its replies — but it cannot modify it. This is the reverse direction of writable shared state.

## How to Interact

Edit the form on the left (name, timezone, recent activity), then ask:

- "What do you know about me from my context?"
- "Based on my recent activity, what should I try next?"
- "What time is it in my timezone?"

The agent's answers should track the values you chose in the form.

## Technical Details

Each call to `useAgentContext` registers a description + a value. CopilotKit serializes these into the AG-UI context payload sent to the Microsoft Agent Framework agent on every run:

```tsx
useAgentContext({
  description: "The currently logged-in user's display name",
  value: userName,
});
useAgentContext({
  description: "The user's IANA timezone (used when mentioning times)",
  value: userTimezone,
});
useAgentContext({
  description: "The user's recent activity in the app, newest first",
  value: recentActivity,
});
```

- The agent treats this as read-only context — there is no tool that lets it write back.
- Changing the form values updates the context the next time the agent runs.
