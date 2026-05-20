# Agentic Chat (Reasoning)

## Why a reasoning model?

PydanticAI's AG-UI bridge surfaces `THINKING_*` / `REASONING_*` events
on the AG-UI stream when the underlying OpenAI Responses API returns
reasoning items. The Responses API only returns reasoning content for
native reasoning models — `gpt-4o` / `gpt-4.1` do not emit reasoning
items.

This demo therefore pins the agent to **`gpt-5`** (the team default
reasoning model) via `OpenAIResponsesModel`, with
`openai_reasoning_summary="auto"` so the API returns reasoning summaries
on each turn.

See `src/agents/reasoning_agent.py` for the model wiring and the page
component for the custom amber `ReasoningBlock` slot that paints the
streamed reasoning content.
