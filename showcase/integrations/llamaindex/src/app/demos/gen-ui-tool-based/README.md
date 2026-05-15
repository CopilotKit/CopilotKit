# Tool-Based Generative UI

## What This Demo Shows

Agent uses tools to trigger UI generation — it picks a chart component and
fills in `title`, `description`, and `data`, and the frontend renders the
result as a styled bar or pie chart.

## How to Interact

Try asking your Copilot to:

- "Show me a bar chart of quarterly sales for Q1, Q2, Q3, Q4."
- "Show me a pie chart of website traffic by source."
- "Show a pie chart of smartphone market share by brand."

The agent generates structured chart data via tool calls, and the frontend
renders it as rich UI components.

## Technical Details

What's happening technically:

- The frontend registers two component tools (`render_bar_chart`,
  `render_pie_chart`) via `useComponent`. Each component's `parameters`
  are typed with a Zod schema.
- AG-UI forwards those tool definitions to the LlamaIndex agent at request
  time, so the LLM picks the right tool based on the user's question
  ("bar" for comparisons, "pie" for share-of-whole).
- When the model emits a tool call, CopilotKit streams the partial JSON
  args into the matching component, which renders incrementally as the
  values arrive.
- The agent itself (`src/agents/gen_ui_tool_based_agent.py`) declares no
  bespoke tools — all tool definitions flow in from the frontend.
