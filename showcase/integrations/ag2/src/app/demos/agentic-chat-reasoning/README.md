# Reasoning

## What This Demo Shows

How to render the agent's thinking chain as a first-class, visually prominent block by overriding CopilotKit's `reasoningMessage` slot.

- **Reasoning as a message type**: the agent emits AG-UI `REASONING_MESSAGE_*` events and CopilotKit renders them as `role: "reasoning"` messages
- **Custom slot override**: a tagged amber "Reasoning" banner replaces the default collapsible card
- **Live streaming state**: the block swaps between "Thinking…" and "Agent reasoning" based on whether the message is the latest while the agent is running

## How to Interact

Try asking:

- "What's the best way to split a dinner bill across 4 people with different entrees?"
- "How many piano tuners are there in Chicago?"
- "Compare REST and gRPC for a mobile backend."

You'll see the agent's step-by-step thinking appear in an italic amber block above its concise answer.

## Technical Details

```tsx
<CopilotChat
  agentId="agentic-chat-reasoning"
  messageView={{ reasoningMessage: ReasoningBlock }}
/>
```

The backend is a `deepagents` `create_deep_agent` graph whose system prompt tells the model to think step-by-step, then answer. The frontend passes a custom `ReasoningBlock` through the `messageView.reasoningMessage` slot on `<CopilotChat>` — the public, stable path for customizing how reasoning messages render. The component receives `message`, `messages`, and `isRunning` so it can show a streaming "Thinking…" label while the latest reasoning message is still filling in.
