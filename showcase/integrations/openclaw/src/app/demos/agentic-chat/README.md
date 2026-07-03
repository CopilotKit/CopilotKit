# Agentic Chat

## What This Demo Shows

The simplest CopilotKit surface: a plain agentic chat backed by the OpenClaw agent.

- **Natural Conversation**: Chat with your Copilot in a familiar chat interface
- **Streaming Responses**: Assistant messages stream in token-by-token via AG-UI
- **Suggestion Chips**: Starter suggestions are rendered as quick-action chips

## How to Interact

Click a suggestion chip, or type your own prompt. For example:

- "Write a short sonnet about AI"
- "Tell me a one-line joke"
- "Walk me through whether 17 is prime"

## Technical Details

**Provider** — `CopilotKit` wires the page to the runtime:

- `runtimeUrl="/api/copilotkit"` points at the Next.js route that, via an
  `HttpAgent`, proxies to the clawg-ui AG-UI operator route on the OpenClaw
  gateway
- `agent="agentic_chat"` selects the agent name the route maps to OpenClaw

**Chat surface** — `CopilotChat` renders the full chat UI with input, message list, and streaming.

**Suggestions** — `useConfigureSuggestions` registers static suggestions that appear as clickable chips below the chat input.
