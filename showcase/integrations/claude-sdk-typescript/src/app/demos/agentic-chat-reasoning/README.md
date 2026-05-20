# Agentic Chat (Reasoning)

## What This Demo Shows

A custom `reasoningMessage` slot renderer (`ReasoningBlock`) paints the
thinking chain in a tagged amber banner. The Claude Agent SDK pass-through
forwards Anthropic extended-thinking deltas as AG-UI `REASONING_MESSAGE_*`
events.

## How to Interact

- "Help me plan a 3-day trip to Tokyo."
- "Compare these two job offers and tell me which to take."
- "Explain why the sky is blue."

## Technical Details

- Slot override happens via the `messageView.reasoningMessage` prop on
  `CopilotChat`.
- Model: Claude 3.7 Sonnet (extended-thinking capable).
