# Tool Rendering

## What This Demo Shows

A raw tool call in the chat shows JSON that users cannot read. Tool rendering replaces each call with a React component that shows its arguments, its status and its result.

- **Per-tool cards**: `get_weather`, `search_flights`, `get_stock_price` and `roll_d20` each have their own branded card.
- **Catch-all card**: any other tool call shows in one generic card.
- **Failure state**: a weather result that is not a full weather report shows an error card with a Retry button.

## How to Interact

Click a suggestion, or type your own prompt. For example:

- "What's the weather in San Francisco?"
- "Find flights from SFO to JFK."
- "Roll a 20-sided die."

The **Chain tools** suggestion calls three tools in one turn, so three cards show.

## Technical Details

`useRenderTool` registers a renderer for one tool name. The renderer gets `parameters`, `status` and `result`, so it can show a loading state while the call runs:

```tsx
useRenderTool(
  {
    name: "get_weather",
    parameters: z.object({ location: z.string() }),
    render: ({ parameters, result, status }) => (
      <WeatherCard loading={status !== "complete"} ... />
    ),
  },
  [],
);
```

- `useDefaultRenderTool` registers the catch-all renderer for every tool without a renderer of its own.
- Retry sends the user prompt that led to the failed call again. The page wraps `CopilotChatView` through the `chatView` slot to get the messages and the submit handler. The button is disabled while a run is active.
- The `tool-rendering-default-catchall` and `tool-rendering-custom-catchall` demos show the two simpler steps: the built-in card only, then one custom card for every tool.
