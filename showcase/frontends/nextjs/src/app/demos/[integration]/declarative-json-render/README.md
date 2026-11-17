# Declarative UI: json-render

## What This Demo Shows

Metrics and trends are hard to read as chat text. Here the agent answers with a json-render spec: a flat JSON tree of components from a catalog. The page renders the spec as metric cards and charts.

## How to Interact

Click a suggestion, or ask for a sales view. For example:

- "Sales dashboard": metric cards and a revenue chart.
- "Revenue by category": a pie chart.
- "Expense trend": a bar chart.

## Technical Details

- `catalog.ts` declares the components (MetricCard, BarChart, PieChart) with Zod schemas. `registry.tsx` maps them to the React components.
- The chat replaces its assistant message with `JsonRenderAssistantMessage`. It takes the first JSON object out of the message, validates it, and renders it with `@json-render/react`.
- While the stream is not a valid spec yet, the default message bubble shows.
- The agent id is `byoc_json_render`.
