# Declarative Generative UI (A2UI)

## What This Demo Shows

The agent dynamically designs a component tree at runtime — a secondary LLM picks components from a frontend-registered catalog and fills in the data.

- **Dynamic schema**: every response can produce a different layout (KPI dashboard, pie chart, bar chart, status report)
- **Catalog-driven**: custom components (`Card`, `StatusBadge`, `Metric`, `InfoRow`, `PrimaryButton`, `PieChart`, `BarChart`) plus the built-in A2UI primitives
- **Secondary LLM**: the `generate_a2ui` tool invokes a second model with the catalog schema injected as context

## How to Interact

Click a suggestion chip, or try:

- "Show me a quick KPI dashboard with 3-4 metrics (revenue, signups, churn)."
- "Show a pie chart of sales by region."
- "Render a bar chart of quarterly revenue."
- "Give me a status report on system health — API, database, and background workers."

## Technical Details

- The frontend registers a catalog via `<CopilotKit a2ui={{ catalog: myCatalog }}>`; `createCatalog` pairs Zod definitions with React renderers and merges the basic A2UI catalog.
- `runtimeUrl="/api/copilotkit-declarative-gen-ui"` and `agent="declarative-gen-ui"` point at `src/agents/a2ui_dynamic.py`, which binds its own `generate_a2ui` tool (`injectA2UITool: false` on the runtime).
- Inside `generate_a2ui`, a secondary `ChatOpenAI` call is forced to emit a `render_a2ui` tool call; the result is wrapped with `a2ui.create_surface` + `a2ui.update_components` + `a2ui.update_data_model` and streamed back as an `a2ui_operations` container.
- `useConfigureSuggestions` seeds the four starter chips above the `CopilotChat` surface.
