# Tool Rendering (Reasoning Chain)

## What This Demo Shows

When an agent thinks between tool calls, users want to see the reasoning next to the results. This demo shows both in one chat: the reasoning of each step, and a card for each tool call.

- **Reasoning blocks**: the reasoning of the agent shows in a custom `ReasoningBlock`.
- **Per-tool cards**: `get_weather` shows a `WeatherCard`, and `search_flights` shows a `FlightListCard`.
- **Catch-all card**: any other tool, for example `get_stock_price` or `roll_dice`, shows in one branded card.

## How to Interact

Click a suggestion. Each one starts a chain of two tool calls:

- **Compare two stocks**: two `get_stock_price` calls, then a comparison.
- **Chain of dice rolls**: a d20 roll, then a d6 roll, then a contrast.
- **Flights + destination weather**: `search_flights`, then `get_weather` for the destination.

## Technical Details

- The agent sends its reasoning as AG-UI reasoning messages. The `reasoningMessage` slot of `messageView` renders them with `ReasoningBlock`.
- `makeSlotOverride` (in `../_shared/slot-override.ts`) gives `ReasoningBlock` the type that the slot expects.
- `useRenderTool` registers the weather and flight cards. `useDefaultRenderTool` registers the catch-all card for every other tool.
- The `reasoning-custom` demo shows the reasoning slot alone. The `tool-rendering` demo shows tool cards alone.
