# Agentic Chat

## What This Demo Shows

The simplest CopilotKit surface: a plain agentic chat backed by a Google ADK (Gemini) agent.

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
- `agent="agentic_chat"` selects the ADK agent registered in `src/agents/registry.py`

**Chat surface** — `CopilotChat` renders the full chat UI with input, message list, and streaming.

**Suggestions** — `useConfigureSuggestions` registers static suggestions that appear as clickable chips below the chat input.
