# Tool Rendering (Reasoning Chain)

Combines visible reasoning steps with sequential tool calls.

- `get_weather` → custom `WeatherCard`
- `search_flights` → custom `FlightListCard`
- everything else (`get_stock_price`, `roll_dice`, …) → branded
  catch-all renderer (`useDefaultRenderTool`)

The Python agent emits AG-UI `REASONING_MESSAGE_*` events (parsed out
of `<reasoning>...</reasoning>` blocks the model emits before each
tool call), then loops on tool calls until the agent has its answer.
