# Tool Rendering (Default Catch-all)

## What This Demo Shows

The simplest tool-rendering setup: opt into CopilotKit's built-in default tool-call card and every backend tool call becomes visible with zero per-tool code.

- **Zero config**: a single `useDefaultRenderTool()` call registers the package's `DefaultToolCallRenderer` under the `*` wildcard
- **Live status pill**: each card shows Running → Done as the call progresses, with collapsible Arguments and Result sections
- **Multi-tool chaining**: the backend prompt encourages the model to chain tools (e.g. `get_weather` → `search_flights`) so multiple cards appear per turn

## How to Interact

Click a suggestion chip, or try asking:

- "What's the weather in San Francisco?"
- "Find flights from SFO to JFK."
- "Roll a 20-sided die."
- "How is AAPL doing?"

Each assistant turn typically produces two cards — the agent is nudged to chain a related call after the first.

## Technical Details

```tsx
useDefaultRenderTool();
```

That single line is the whole frontend tool-rendering surface. Without it, `useRenderToolCall` has no `*` renderer to fall back on and tool calls render invisibly — users only see the final text summary. The backend `tool_rendering_agent` exposes four mock tools (`get_weather`, `search_flights`, `get_stock_price`, `roll_dice`), all of which now flow through the same default card.
