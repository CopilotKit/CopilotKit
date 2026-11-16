# Tool Rendering (Default Catch-all)

## What This Demo Shows

Without a renderer, tool calls are invisible: the user sees only the final answer of the agent. One hook call shows every tool call with the built-in card of CopilotKit.

- **Built-in card**: each call shows its tool name, its status, and its arguments and result.
- **Grouping**: the chat puts calls made in a row into one card, with a row for each call.
- **No custom UI**: the page registers no renderer of its own.

## How to Interact

Click a suggestion, or type your own prompt. For example:

- "What's the weather in San Francisco?"
- "Find flights from SFO to JFK."
- "Roll a 20-sided die."

Open a card to see the arguments and the result of each call.

## Technical Details

`useDefaultRenderTool()` with no config registers the built-in renderer for the `*` wildcard:

```tsx
useDefaultRenderTool();
```

- The built-in renderer marks each call with `data-testid="copilot-tool-render"` and a `data-tool-name` attribute.
- The `tool-rendering-custom-catchall` demo replaces this card with a custom one. The `tool-rendering` demo adds a card for each tool.
