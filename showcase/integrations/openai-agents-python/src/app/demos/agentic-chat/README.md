# Agentic Chat

## What This Demo Shows

The simplest CopilotKit surface: a plain agentic chat backed by an OpenAI Agents SDK `Agent`, served over AG-UI by the `ag-ui-openai-agents` adapter.

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
- `agent="agentic_chat"` selects the agent mounted at `/agentic_chat` by `agent_server.py` — the shared `neutral_agent()` defined in `src/demo_agents/chat.py` (see `src/demo_agents/registry.py`), the same instance every neutral chat-UI demo on this integration uses

**Chat surface** — `CopilotChat` renders the full chat UI with input, message list, and streaming.

**Suggestions** — `useConfigureSuggestions` registers a static suggestion that appears as a clickable chip below the chat input.
