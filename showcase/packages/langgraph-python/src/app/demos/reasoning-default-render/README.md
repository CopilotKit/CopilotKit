# Reasoning (Default Render)

## What This Demo Shows

The zero-config path for surfacing an agent's thinking chain — pair a reasoning-capable agent with a plain `<CopilotChat>` and CopilotKit handles the rest.

- **No custom slots**: the page passes no `messageView` override
- **Built-in reasoning card**: `CopilotChatReasoningMessage` renders reasoning messages as a collapsible "Thinking… / Thought for X" card automatically
- **Same backend as the custom variant**: compare side-by-side with the `Reasoning` demo to see exactly what a slot override changes

## How to Interact

Try asking:

- "What's the best way to split a dinner bill across 4 people with different entrees?"
- "How many piano tuners are there in Chicago?"
- "Compare REST and gRPC for a mobile backend."

The default card appears above the final answer and can be expanded to see the full thinking chain.

## Technical Details

```tsx
<CopilotKit runtimeUrl="/api/copilotkit" agent="reasoning-default-render">
  <CopilotChat agentId="reasoning-default-render" />
</CopilotKit>
```

The backend uses `deepagents.create_deep_agent` with a system prompt that instructs the model to think step-by-step before answering. Those thoughts stream as AG-UI `REASONING_MESSAGE_*` events, which CopilotKit's `CopilotChatMessageView` dispatches to the default `CopilotChatReasoningMessage` component — no configuration required on the frontend.
