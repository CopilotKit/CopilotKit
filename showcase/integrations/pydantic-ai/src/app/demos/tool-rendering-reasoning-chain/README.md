# Tool Rendering (Reasoning Chain)

## Why a reasoning model?

This cell demonstrates the full `reasoning → tool call → reasoning →
tool call` chain in a single chat surface. To exercise that chain, the
backend has to actually emit reasoning events alongside its tool calls.

PydanticAI's AG-UI bridge surfaces `REASONING_*` events only when the
underlying OpenAI Responses API returns reasoning items, which it only
does for native reasoning models (`gpt-4o` / `gpt-4.1` do not emit
reasoning items). We therefore pin the backend to **`gpt-5`** via
`OpenAIResponsesModel`, with `openai_reasoning_summary="auto"` so the
Responses API includes reasoning summaries with each turn.

The four shared backend tools (`get_weather`, `search_flights`,
`get_stock_price`, `roll_dice`) mirror the `tool-rendering` (primary)
cell so users can compare reasoning-on vs reasoning-off side-by-side.

See `src/agents/tool_rendering_reasoning_chain_agent.py`.
