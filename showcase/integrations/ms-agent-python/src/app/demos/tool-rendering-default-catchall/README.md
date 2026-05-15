# Tool Rendering — Default Catch-all (MS Agent Framework)

The simplest point in the tool-rendering progression.

- **Backend** (Python, MS Agent Framework) — the shared
  `tool_rendering_reasoning_chain_agent` exposes mock `get_weather`,
  `search_flights`, `get_stock_price`, and `roll_dice` tools.
- **Frontend** — no per-tool renderers. A single call to
  `useDefaultRenderTool()` opts the chat into CopilotKit's built-in
  `DefaultToolCallRenderer`, which paints every tool call with a
  generic "Tool / Running → Done / Arguments / Result" card.

## Why this cell exists

Without `useDefaultRenderTool()` there is **no** wildcard renderer and
tool calls render as nothing at all — the user only sees the final
assistant text summary. Opting in with zero config is the baseline for
any app that wants the AG-UI tool-call lifecycle to be visible without
writing custom UI.

Progresses into:

- `tool-rendering-custom-catchall` — same shape, swaps the built-in
  card for a branded wildcard renderer.
- `tool-rendering-reasoning-chain` — adds per-tool renderers and a
  reasoning slot on top of the catch-all.
