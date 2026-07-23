# Tool Rendering: Reasoning Chain (built-in-agent)

Sequential tool calls interleaved with the agent's visible reasoning
chain. Backed by the shared reasoning runtime
(`/api/copilotkit-reasoning`, agent `tool-rendering-reasoning-chain`)
which uses a reasoning-capable OpenAI model (`gpt-5.2`) with
`reasoning_effort: "low"`. The runtime's tanstack converter forwards
upstream `REASONING_*` events as AG-UI reasoning events, and the chat
renders them via a custom `reasoningMessage` slot for visual emphasis.

Tool rendering is wired the same way as the primary `tool-rendering`
demo:

- `get_weather` → `<WeatherCard />`
- `search_flights` → `<FlightListCard />`
- `*` (catch-all) → `<CustomCatchallRenderer />`

The reasoning chain is what makes this a _chain_ — the model can think,
call a tool, think again, and call another tool, all visible in the
chat.

- Dedicated route: `/api/copilotkit-reasoning`
- Single-route mode, registered under agent ID `tool-rendering-reasoning-chain`
- Key files: `page.tsx`, `reasoning-block.tsx`, `weather-card.tsx`,
  `flight-list-card.tsx`, `custom-catchall-renderer.tsx`,
  `../../api/copilotkit-reasoning/route.ts`,
  `../../../lib/factory/reasoning-factory.ts`
