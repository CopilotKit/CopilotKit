# Tool Rendering + Reasoning Chain (testing)

## What This Demo Shows

A deep-agent travel/lifestyle concierge that chains multiple tool calls per turn, with custom renderers for each tool and a custom reasoning-block slot for the agent's chain-of-thought.

- **Per-tool renderers**: `get_weather` renders as `WeatherCard`, `search_flights` renders as `FlightListCard`
- **Catch-all renderer**: `get_stock_price`, `roll_dice`, and any other tool flow through `useDefaultRenderTool` to a generic `CustomCatchallRenderer`
- **Reasoning block**: the agent's reasoning tokens render via a custom `reasoningMessage` slot on `CopilotChat`
- **Sequential tool calls**: the system prompt pushes the model to call 2+ tools in succession when relevant

## How to Interact

Try asking:

- "What's the weather in Tokyo?"
- "How is AAPL doing?"
- "Roll a 20-sided die for me"
- "Find flights from SFO to JFK"

Prompts that imply multiple tools (e.g. "flights to Tokyo and the weather there") will trigger a chain of calls, each rendering its own card.

## Technical Details

- `useRenderTool({ name, parameters, render })` binds a React component to a specific backend tool; `render` receives `{ parameters, result, status }` and switches on `status !== "complete"` for loading states
- `useDefaultRenderTool({ render })` registers a fallback renderer used for any tool without a dedicated binding
- `CopilotChat`'s `messageView={{ reasoningMessage: ReasoningBlock }}` overrides the default reasoning display
- Backend is a `create_deep_agent(...)` (from `deepagents`) with four `@tool`s; `agent="tool-rendering-reasoning-chain"`
