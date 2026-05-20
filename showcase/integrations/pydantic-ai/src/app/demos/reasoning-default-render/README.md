# Reasoning (Default Render)

## Why a reasoning model?

The CopilotKit v2 chat ships with a built-in `CopilotChatReasoningMessage`
slot that renders streamed reasoning content as a collapsible
"Thinking… / Thought for X" card. To exercise that path the agent has to
emit AG-UI reasoning events.

PydanticAI's AG-UI bridge only surfaces `REASONING_*` events when the
underlying OpenAI Responses API returns reasoning items, which it only
does for native reasoning models. We therefore pin **`gpt-5`** here via
`OpenAIResponsesModel` and set `openai_reasoning_summary="auto"` so the
Responses API includes reasoning summaries on every turn.

The frontend deliberately wires NO custom slot — the zero-config default
renderer is the focal point.

See `src/agents/reasoning_agent.py` for the model wiring (shared with
`agentic-chat-reasoning`).
