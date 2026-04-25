# Tool Rendering — Custom Catch-all (MS Agent Framework)

Middle of the tool-rendering progression.

- **Backend** (Python, MS Agent Framework) — reuses the shared
  `tool_rendering_reasoning_chain_agent` with its mock `get_weather`,
  `search_flights`, `get_stock_price`, and `roll_dice` tools.
- **Frontend** — swaps CopilotKit's built-in default tool-call card for
  a single branded wildcard renderer via `useDefaultRenderTool({ render })`.

## Why this cell exists

`useDefaultRenderTool` is a convenience wrapper around
`useRenderTool({ name: "*", ... })`. Passing a `render` prop overrides
the package-provided default card with a custom one. The branded
`CustomCatchallRenderer` shows the tool name, a live status pill
(`streaming → running → done`), and pretty-printed arguments and
result — all without writing per-tool UI.

Progresses into:

- `tool-rendering-reasoning-chain` — layers named per-tool renderers
  (`get_weather`, `search_flights`) and a reasoning slot on top of the
  same catch-all.
