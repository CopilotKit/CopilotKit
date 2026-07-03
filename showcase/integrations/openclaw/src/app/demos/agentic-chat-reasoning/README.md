# Agentic Chat (Reasoning)

## What This Demo Shows

The same streaming chat as `agentic-chat`, but the OpenClaw agent runs in
reasoning "stream" mode, so its thinking is surfaced in the UI.

- **Reasoning Panel**: `REASONING_*` events arrive alongside the answer and
  `CopilotChat` renders them as a reasoning panel above the response
- **Streaming Responses**: The final answer still streams in token-by-token
- **Suggestion Chips**: Starter suggestions are rendered as quick-action chips

## How to Interact

Click a suggestion chip, or type a prompt that benefits from step-by-step
thinking. Watch the reasoning panel populate before the answer arrives:

- "Walk me through whether 17 is prime"
- "Solve a small logic puzzle out loud"

## Technical Details

**Provider** — `CopilotKit` with `runtimeUrl="/api/copilotkit"` (which proxies
via an `HttpAgent` to the clawg-ui AG-UI operator route on the OpenClaw
gateway) and `agent="agentic-chat-reasoning"`.

**Reasoning** — No custom slot is wired. Because OpenClaw streams
`REASONING_MESSAGE_*` events over AG-UI, `CopilotChat`'s built-in reasoning
rendering displays them automatically as a collapsible reasoning panel.

**Suggestions** — `useConfigureSuggestions` registers static suggestion chips.
