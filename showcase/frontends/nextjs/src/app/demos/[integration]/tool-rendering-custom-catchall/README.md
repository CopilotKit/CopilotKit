# Tool Rendering (Custom Catch-all)

## What This Demo Shows

The built-in tool card does not always match the look of your app. One custom catch-all renderer gives every tool call your own card, with no work for each tool.

- **One branded card**: every tool call shows in the same card, with the tool name, a status badge, the arguments and the result.
- **No per-tool renderers**: the same card handles weather, flights and dice.

## How to Interact

Click a suggestion, or type your own prompt. For example:

- "What's the weather in San Francisco?"
- "Find flights from SFO to JFK."
- "Roll a 20-sided die."

The **Chain tools** suggestion calls three different tools. All three show in the same card style.

## Technical Details

`useDefaultRenderTool` with a `render` function replaces the built-in card for every tool without a renderer of its own:

```tsx
useDefaultRenderTool(
  {
    render: ({ name, parameters, status, result }) => (
      <CustomCatchallRenderer
        name={name}
        parameters={parameters}
        status={status}
        result={result}
      />
    ),
  },
  [],
);
```

- `custom-catchall-renderer.tsx` parses the result as JSON. Some agent adapters wrap the JSON in another JSON string, so it parses up to three layers.
- The `_components` folder holds small copies of the shadcn/ui `Card` and `Badge`, so the demo needs no extra UI library.
- The `tool-rendering` demo adds a dedicated card for each tool on top of a catch-all.
