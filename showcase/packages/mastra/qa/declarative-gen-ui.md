# QA: Declarative Generative UI (A2UI — Dynamic Schema) — Mastra

## Test Steps

- [ ] Navigate to `/demos/declarative-gen-ui`
- [ ] Verify the CopilotChat surface renders with the suggestion chips
- [ ] Click "Show a KPI dashboard"; verify the agent calls `generate_a2ui`
  and a Card with 3-4 `Metric` components renders
- [ ] Click "Pie chart — sales by region"; verify a `PieChart` renders with
  legend + SVG donut
- [ ] Click "Bar chart — quarterly revenue"; verify the `BarChart` renders
  via Recharts with brand palette
- [ ] Click "Status report"; verify `StatusBadge` + `InfoRow` compose
  inside a Card

## Expected Results

- A2UI dynamic catalog resolves `Card`, `Metric`, `StatusBadge`,
  `InfoRow`, `PrimaryButton`, `PieChart`, `BarChart` from
  `./a2ui/renderers.tsx`
- The `generate_a2ui` tool on the Mastra weatherAgent produces operations
  that the `@copilotkit/a2ui-renderer` intercepts and renders.
