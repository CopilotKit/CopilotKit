# Reasoning (custom render)

The default reasoning block closes when the model is done. This demo keeps the reasoning visible with its own component, in the `reasoningMessage` slot of the chat's message view.

## Try it

1. Open `/demos/<integration>/reasoning-custom`.
2. Click the "Show reasoning" suggestion.

A tagged banner shows the reasoning in italics. Its label reads "Thinking..." while the model streams, then "Agent reasoning".

## How it works

`page.tsx` puts `ReasoningBlock` in the slot:

```tsx
<CopilotChat
  agentId={AGENT_ID}
  messageView={{
    reasoningMessage:
      makeSlotOverride<typeof CopilotChatReasoningMessage>(ReasoningBlock),
  }}
/>
```

- The slot gives `ReasoningBlock` the reasoning message, the message list, and whether the agent is running.
- `makeSlotOverride` (in `../_shared/slot-override.ts`) tells TypeScript that `ReasoningBlock` fits the slot.

## Files

- `page.tsx`: the provider and the chat with the slot override.
- `reasoning-block.tsx`: the banner.
- `suggestions.ts`: the "Show reasoning" suggestion.

## What the integration needs

- An agent for `createRuntimeConfig("reasoning-custom")`, with the id `reasoning-custom`.
- The agent streams AG-UI `REASONING_MESSAGE_*` events.

The banner now replaces the default block for every reasoning message in this chat.
