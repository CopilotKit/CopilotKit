# Tool Rendering — Reasoning Chain (MS Agent Framework)

End of the tool-rendering progression. Composes two previously-separate
patterns in a single cell:

1. **Reasoning tokens** rendered via a custom `reasoningMessage` slot
   (branded `ReasoningBlock`) — same approach as the
   `agentic-chat-reasoning` cell.
2. **Sequential tool calls** with a mix of named and wildcard
   renderers:
   - `get_weather` → `<WeatherCard />`
   - `search_flights` → `<FlightListCard />`
   - `*` → `<CustomCatchallRenderer />` for anything else
     (`get_stock_price`, `roll_dice`)

## Backend

The Python agent lives at
`src/agents/tool_rendering_reasoning_chain_agent.py` and is mounted at
`/tool-rendering-reasoning-chain` in `agent_server.py`. The system
prompt nudges the model to chain at least two tool calls per user
question so the UI exercises the full rendering progression in a single
reply.

## Why this cell exists

Shows how named per-tool renderers co-exist with a catch-all wildcard
renderer, and how reasoning events render inline with the tool-call
cards. Named renderers always win over the wildcard — the wildcard only
paints calls that don't have a dedicated card.
