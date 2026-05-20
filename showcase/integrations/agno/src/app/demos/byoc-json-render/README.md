# BYOC: JSON Render

## What This Demo Shows

The Agno agent emits a `@json-render/react` flat element-tree spec
(`{ root, elements }`), and the frontend mounts it against a Zod-
validated catalog of three components (MetricCard, BarChart, PieChart).
Direct comparison cell to BYOC: Hashbrown — same data shapes, different
rendering technology.

## Technical Details

- Runtime: `src/app/api/copilotkit-byoc-json-render/route.ts`.
- Agent: `src/agents/byoc_json_render_agent.py`.
- Catalog + registry: `catalog.ts` + `registry.tsx` — single source of
  truth for the catalog shape and the React component bindings.
