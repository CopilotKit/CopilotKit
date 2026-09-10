# Tool-Based Generative UI

The frontend registers `render_bar_chart` and `render_pie_chart` as tools via
`useComponent`, each with a schema and a `render` component. Because
Antigravity fixes its tool list on the harness at connect time, the adapter
picks these straight up off `RunAgentInput.tools` — no backend tool
declaration is needed for them at all. The agent
(`gen_ui_tool_based_agent()` in `src/agents/gen_ui_tool_based.py`) is
instructed to call one of these tools whenever the user asks for a chart,
inventing illustrative sample data if none was supplied, rather than asking
a clarifying question.

`useComponent` maps each tool name to the component that renders its call, so
CopilotKit shows the chart in place of a raw tool-call bubble as soon as the
model invokes it.

The canonical description lives in the showcase manifest; this README is just
a developer note alongside the demo source.
