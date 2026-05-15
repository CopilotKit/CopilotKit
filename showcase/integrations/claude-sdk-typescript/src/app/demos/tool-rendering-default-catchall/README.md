# Tool Rendering — Default Catch-all

## What This Demo Shows

`useDefaultRenderTool()` (zero-config) opts into CopilotKit's built-in
`DefaultToolCallRenderer` for every tool call — no per-tool renderers required.

## How to Interact

Try asking your Copilot to:

- "What's the weather in San Francisco?"
- "Find flights from SFO to JFK."
- "Roll a 20-sided die."

## Technical Details

- The Claude Agent SDK pass-through forwards frontend-registered tools to the
  Anthropic Messages API. Mock tools (`get_weather`, `search_flights`,
  `get_stock_price`, `roll_dice`) are registered via `useFrontendTool` with
  stub handlers so the agent can call them and the catch-all renderer paints
  every result.
- Without `useDefaultRenderTool()` the runtime has no `*` renderer, so tool
  calls fall through to `null` and only the assistant's text reply is shown.
