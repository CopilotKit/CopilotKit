# Tool Rendering — Custom Catch-all

## What This Demo Shows

A SINGLE custom wildcard renderer registered via `useDefaultRenderTool({ render })`
paints every tool call with the same branded card.

## How to Interact

- "What's the weather in San Francisco?"
- "Find flights from SFO to JFK."
- "Roll a 20-sided die."

## Technical Details

- Same mock tool suite as `tool-rendering-default-catchall`, registered via
  `useFrontendTool` so the Claude Agent SDK pass-through can call them.
- `useDefaultRenderTool` is a convenience wrapper around
  `useRenderTool({ name: "*", ... })` — one wildcard render covers everything
  not claimed by a named per-tool renderer.
