# A2UI Renderer

The A2UI (Agent-to-UI) renderer uses a predefined component catalog that the agent
composes into a component tree at runtime. Instead of calling individual tool functions,
the backend agent (via `generate_a2ui`) produces A2UI operations that assemble dashboard
cards, charts, metrics, tables, and layout primitives from the catalog.

## How it works

1. The `demonstrationCatalog` defines available components (Title, Row, Column,
   DashboardCard, Metric, PieChart, BarChart, Badge, DataTable, Button, FlightCard)
   with Zod-validated props and React renderers.
2. The backend agent calls `generate_a2ui` to produce a tree of catalog operations.
3. The A2UI renderer resolves the operation tree into React components on the frontend.
4. `useShowcaseHooks()` still registers tool-based components for hybrid usage.

## When to use

Use this renderer when you want the agent to compose UI from a curated component
catalog. This provides medium constraint -- the agent can arrange components freely
but cannot introduce components outside the catalog.
