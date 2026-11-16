# Reasoning (default render)

A reasoning model thinks before it answers, and users want to see that thinking. CopilotChat shows it with no extra code: it renders each reasoning message as a collapsible block.

## Try it

1. Open `/demos/<integration>/reasoning-default`.
2. Click the "Show reasoning" suggestion.

The block reads "Thinking..." while the model reasons. When the model is done, the block closes and reads "Thought for" and the time.

## Files

- `page.tsx`: the provider and the chat, with no slot override.
- `suggestions.ts`: the "Show reasoning" suggestion. It asks a real question, because a reasoning model streams reasoning only for a real problem.

## What the integration needs

- An agent for `createRuntimeConfig("reasoning-default")`, with the id `reasoning-default`.
- The agent streams AG-UI `REASONING_MESSAGE_*` events.

To change how the block looks, see `reasoning-custom`.
