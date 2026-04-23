# Tool Rendering (Custom Catch-all)

## What This Demo Shows

A single branded wildcard renderer handles every tool call — the middle step between the built-in default card and per-tool custom renderers.

- **One custom component, all tools**: a branded card replaces CopilotKit's default tool-call UI for every call
- **Status-aware UI**: the card reflects `inProgress` (streaming args), `executing` (tool running), and `complete` (done) with distinct badges
- **Same backend as the default catch-all**: identical tool set; the only difference is the frontend renderer

## How to Interact

Click a suggestion chip, or try asking:

- "What's the weather in San Francisco?"
- "Find flights from SFO to JFK."
- "Roll a 20-sided die."
- "How is AAPL doing?"

The backend prompt nudges the agent to chain a second tool after the first, so expect two branded cards per turn.

## Technical Details

```tsx
useDefaultRenderTool({
  render: ({ name, parameters, status, result }) => (
    <CustomCatchallRenderer name={name} parameters={parameters} status={status} result={result} />
  ),
}, []);
```

`useDefaultRenderTool` is a convenience wrapper around `useRenderTool({ name: "*", ... })` — a single wildcard renderer claims every tool call not picked up by a named renderer. The `CustomCatchallRenderer` receives the tool `name`, parsed `parameters`, a `status` enum, and the streamed `result` string so it can show a live "streaming → running → done" badge and a formatted arguments/result view.
