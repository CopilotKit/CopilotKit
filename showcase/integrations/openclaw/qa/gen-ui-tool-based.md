# QA: Tool-Based Generative UI (OpenClaw)

Demo source: `src/app/demos/gen-ui-tool-based/page.tsx`
Route: `/demos/gen-ui-tool-based` · Agent: `gen-ui-tool-based`

## What it exercises

Two render tools defined in React with `useComponent` — `render_bar_chart` and
`render_pie_chart` — each mapped to a custom Recharts/SVG component. The schemas
(title, description, `data: {label, value}[]`) are forwarded over AG-UI in
`RunAgentInput.tools`; the ag-ui adapter hands them to OpenClaw as
caller-provided **client tools** (`runtime.agent.runEmbeddedAgent({ clientTools })`),
so the model can call them. When the model calls a chart tool, ag-ui emits
`TOOL_CALL_START/ARGS/END` and the page renders the matching chart component
**inline in the chat transcript** from the tool args — the tool has no browser
side effect, the rendered component _is_ the result.

OpenClaw is a single stateless gateway endpoint; per-demo behaviour comes from
the frontend tools, not a per-demo backend graph. `PARITY_NOTES.md` lists this
demo as **supported** under "Tools & generative UI".

## Manual steps

1. Open the demo. Confirm the `CopilotChat` panel renders and three suggestion
   chips appear: **Sales bar chart**, **Traffic pie chart**, **Market share**.
2. Click **Sales bar chart** (or ask: _"Show me a bar chart of quarterly sales
   for Q1, Q2, Q3, Q4."_).
3. Expect: the model calls `render_bar_chart`, and a bar chart card renders
   inline in the transcript with a title, subtitle, and four animated bars
   (Q1–Q4) with tooltips on hover.
4. Click **Traffic pie chart** (or ask: _"Show me a pie chart of website
   traffic by source."_).
5. Expect: the model calls `render_pie_chart`, and a donut chart card renders
   inline with color-coded slices plus a legend showing each label, value, and
   percentage.
6. Click **Market share** to generate a second pie chart. Confirm it renders as
   a new card below the earlier ones — prior charts stay in the transcript.

## Assertion bar

- Each request renders an actual chart component inline (not a JSON dump or a
  plain-text description of the data).
- Bar chart: one bar per data point, labels on the X axis, values reflected in
  bar heights; pie chart: slice sizes and legend percentages sum to ~100%.
- Exactly one chart per tool call (no duplicate render, no empty
  "No data available" card when data was provided).
- Chart cards persist as the conversation continues; newest appears below.

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` carrying the
`render_bar_chart` tool to `http://127.0.0.1:8000/v1/ag-ui/operator`
(Bearer gateway token, `Accept: text/event-stream`) with a message like _"bar
chart of Q1–Q4 sales"_. Confirm the SSE contains a single `TOOL_CALL_START` for
`render_bar_chart`, its `TOOL_CALL_ARGS` carry a well-formed `data` array, then
`RUN_FINISHED`.

## Caveats

- These are **render-only** tools: the model supplies the data as tool args and
  the frontend draws it. There is no backend chart computation and no tool
  result fed back to the model, so the model's follow-up text will not "read"
  the rendered chart.
- Chart quality depends on the model choosing sensible sample data; exact
  numbers vary run to run.
