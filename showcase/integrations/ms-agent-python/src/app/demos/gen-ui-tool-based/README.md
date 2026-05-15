# Tool-Based Generative UI

## What This Demo Shows

Agent uses tools to trigger UI generation — frontend-defined chart components
are exposed as tools the backend agent can call.

## How to Interact

Try asking your Copilot to:

- "Show me a bar chart of quarterly sales for Q1, Q2, Q3, Q4."
- "Show me a pie chart of website traffic by source."
- "Show a pie chart of smartphone market share by brand."

The agent picks the right chart type and emits a tool call with structured
`{label, value}` data; the frontend renders the result inline.

## Technical Details

- The chart components (`BarChart`, `PieChart`) are registered on the frontend
  via `useComponent` from `@copilotkit/react-core/v2`. Each registration ships
  a Zod parameter schema and a render function.
- CopilotKit's runtime forwards those tool definitions to the MS Agent
  Framework agent at request time, so the agent never sees them as backend
  tools — it just calls `render_bar_chart` or `render_pie_chart` by name.
- The MS Agent Framework agent (`gen_ui_tool_based_agent.py`) has `tools=[]`
  and a system prompt that nudges it to choose the right chart for the
  question and pass concise `{title, description, data}` arguments.
