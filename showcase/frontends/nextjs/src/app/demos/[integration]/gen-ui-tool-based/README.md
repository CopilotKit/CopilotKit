# Tool-Based Generative UI

## What This Demo Shows

A chart says more than a paragraph of numbers. With tool-based generative UI, the agent picks a component from your app and fills in its props. Then the chart shows in the chat.

- **Bar chart**: the page registers `render_bar_chart`.
- **Pie chart**: the page registers `render_pie_chart`.
- **Suggestions**: three chart prompts show as chips below the chat input.

## How to Interact

Click a suggestion, or type your own prompt. For example:

- "Show me a bar chart of quarterly sales for Q1, Q2, Q3, Q4."
- "Show me a pie chart of website traffic by source."
- "Show a pie chart of smartphone market share by brand."

## Technical Details

`useComponent` registers a component as a tool. The Zod schema of the component props is the parameter schema of the tool:

```tsx
useComponent({
  name: "render_bar_chart",
  description: "Display a bar chart with labeled numeric values.",
  parameters: barChartPropsSchema,
  render: BarChart,
});
```

- CopilotKit sends the tool to the agent on each run. The agent server needs no declaration for it.
- When the agent calls the tool, CopilotKit renders the component with the tool arguments as props.
- `bar-chart.tsx` draws with Recharts. `pie-chart.tsx` draws a plain SVG donut.
