# Tool-Based Generative UI

## What This Demo Shows

Generative UI driven by a FRONTEND tool with a `render` function. The demo
registers one tool — `render_chart` — via `useFrontendTool`. Its schema is
forwarded over AG-UI to the OpenClaw agent as a caller-provided client tool.
When the agent calls `render_chart`, CopilotChat drives the tool's `render`
function through its `inProgress` → `executing` → `complete` lifecycle, and the
render function draws a bar or pie chart from the tool arguments — no plain-text
reply required.

- **Render, not handler**: `render_chart` has no `handler`; it exists purely to
  paint UI from the tool-call arguments.
- **Self-contained charts**: `chart-card.tsx` draws bar and pie/donut charts
  with plain SVG/CSS — no charting library, no cross-cell imports.
- **Live lifecycle**: the card exposes `data-status` so you can watch it move
  from streaming to complete.

## How to Interact

Ask the agent to visualize some data, then watch the chart render inline. For
example:

- "Show me a bar chart of quarterly sales for Q1, Q2, Q3, Q4."
- "Show me a pie chart of website traffic by source."

## Technical Details

**Provider** — `CopilotKit` with `runtimeUrl="/api/copilotkit"` (proxying via an
`HttpAgent` to the clawg-ui AG-UI operator route on the OpenClaw gateway) and
`agent="gen-ui-tool-based"`.

**Frontend tool with render** — `useFrontendTool({ name: "render_chart",
parameters, render })`. clawg-ui hands the forwarded tool to OpenClaw as a
client tool; when the model calls it, the run stops with a pending tool call and
`CopilotChat` renders the `ChartCard` from the arguments.
