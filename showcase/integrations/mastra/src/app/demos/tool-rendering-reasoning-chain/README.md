# Tool Rendering + Reasoning Chain

## What This Demo Shows

Sequential tool calls rendered with per-tool components plus a reasoning chain rendered inline via a custom `reasoningMessage` slot.

## How to Interact

Try asking:

- "What's the weather in Tokyo?"
- "Find flights from SFO to JFK."
- "Roll a 20-sided die for me."

The agent's reasoning tokens stream into a `ReasoningBlock` while tool calls render as `WeatherCard`, `FlightListCard`, or the catch-all renderer.

## Technical Details

- `useRenderTool({ name: "get_weather" })` and `useRenderTool({ name: "search_flights" })` register named per-tool renderers
- `useDefaultRenderTool` registers the catch-all that handles every other tool
- The reasoning chain comes from AG-UI `REASONING_MESSAGE_*` events emitted by the Mastra agent when the underlying model produces reasoning tokens
- The `messageView.reasoningMessage` slot on `<CopilotChat />` overrides the default reasoning UI
