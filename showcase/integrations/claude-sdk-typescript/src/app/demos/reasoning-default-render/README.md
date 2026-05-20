# Reasoning (Default Render)

## What This Demo Shows

The Claude Agent SDK pass-through enables Anthropic extended thinking and
forwards `thinking_delta` events as AG-UI `REASONING_MESSAGE_*` events. The
chat renders them with CopilotKit's built-in `CopilotChatReasoningMessage`
collapsible card — zero custom configuration.

## How to Interact

- "Help me plan a 3-day trip to Tokyo."
- "Should I rent or buy in this market?"
- "Walk me through how a CDN works."

## Technical Details

- Backend uses Claude 3.7 Sonnet with `thinking: { type: "enabled" }`.
- Override the model with `CLAUDE_REASONING_MODEL`.
- Default reasoning slot lives in `@copilotkit/react-core/v2`.
