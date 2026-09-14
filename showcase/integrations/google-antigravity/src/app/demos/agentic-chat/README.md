# Agentic Chat

## What This Demo Shows

The simplest CopilotKit surface: a plain agentic chat backed by an `AntigravityAgent` — Google Antigravity's SDK driving a Go harness subprocess through the `ag-ui-antigravity` adapter.

- **Natural Conversation**: Chat with your Copilot in a familiar chat interface
- **Streaming Responses**: Assistant messages stream in token-by-token via AG-UI
- **Suggestion Chips**: A starter suggestion is rendered as a quick-action chip

## How to Interact

Click the suggestion chip, or type your own prompt. For example:

- "Write a short sonnet about AI"
- "Explain the difference between an LLM and an agent"
- "Give me three ideas for a weekend project"

## Technical Details

**Provider** — `CopilotKit` wires the page to the runtime:

- `runtimeUrl="/api/copilotkit"` points at the Next.js route that proxies to the agent
- `agent="agentic_chat"` selects the `AntigravityAgent` mounted at `/agentic_chat` by `agent_server.py`'s `create_antigravity_app({...})` — the shared `neutral_agent()` defined in `src/agents/chat.py` (see `src/agents/registry.py`), the same instance every neutral chat-UI demo on this integration uses

**Chat surface** — `CopilotChat` renders the full chat UI with input, message list, and streaming.

**Suggestions** — `useConfigureSuggestions` registers a static suggestion that appears as a clickable chip below the chat input.
