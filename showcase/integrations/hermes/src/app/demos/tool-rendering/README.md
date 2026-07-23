# Tool Rendering

Client-executed frontend tool calls are rendered as React components in the
chat transcript. Hermes has no backend `get_weather`/`search_flights`/… tools,
so each tool is registered on the frontend via `useFrontendTool` with a
deterministic fake-data handler plus a per-tool `render` (WeatherCard,
FlightListCard, StockCard, D20Card), receiving `args`, `result`, and `status`
so the UI can reflect both in-flight and completed calls. A
`useDefaultRenderTool` wildcard catch-all paints anything without a per-tool
renderer.

The canonical description lives in the showcase manifest; this README is just
a developer note alongside the demo source.
