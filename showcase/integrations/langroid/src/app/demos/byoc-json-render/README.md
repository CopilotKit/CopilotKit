# BYOC: json-render — Langroid

Frontend BYOC via `@json-render/react`. The agent emits a single JSON spec shaped like `{ root, elements }`; the page wires a custom `messageView.assistantMessage` slot that parses the streaming content (tolerating partial tokens, code fences, and prose preamble), validates element types against a Zod-validated catalog, and feeds the spec into `<Renderer />`.

## Topology

- **Page** — `src/app/demos/byoc-json-render/page.tsx`. Mounts `<CopilotKit agent="byoc_json_render">` and overrides CopilotChat's `messageView.assistantMessage`.
- **Renderer** — `json-render-renderer.tsx`. Walks the streaming content with a balanced-brace JSON extractor; only swaps to `<Renderer />` once the spec parses AND every referenced `type` is in the catalog allowlist (`MetricCard | BarChart | PieChart`). Until then the default `CopilotChatAssistantMessage` renders the raw text — keeps the bubble visually consistent during streaming.
- **Catalog** — `catalog.ts`. Single source of truth: `defineCatalog(schema, { components: { MetricCard, BarChart, PieChart } })`. The Zod props schemas are mirrored verbatim into the agent's system prompt via `CATALOG_DESCRIPTION`.
- **Registry** — `registry.tsx`. Bridges the catalog to concrete React components. The MetricCard wrapper forwards `children` so multi-component dashboards (root MetricCard + chart in `children`) render as one wrapped block instead of dropping the chart.
- **Charts** — `charts/{pie-chart,bar-chart,chart-config}.tsx`. Same recharts-based components as the hashbrown demo, but the `data` prop is passed as a real array (json-render's catalog validator handles arrays natively).
- **Runtime route** — `src/app/api/copilotkit-byoc-json-render/route.ts`. Single-agent runtime targeting `${AGENT_URL}/byoc-json-render`.
- **Agent** — `src/agents/byoc_json_render_agent.py`. Forces `response_format: json_object` and streams a single TEXT_MESSAGE triple. System prompt includes three worked examples covering each component type plus a `MetricCard.children` containing a chart.

## Why a parse-then-swap strategy?

`@json-render/core`'s `SpecStream` compiler consumes JSONL patches, but the agent emits a single JSON object. Buffering until the content is valid JSON loses progressive in-JSON rendering but gains correct behavior against the agent's actual output shape — see R2 in the langgraph-python demo's spec. Once the spec parses cleanly the swap is instant; partial-stream rendering of `<Renderer />` would require the agent to emit JSONL diffs, which is out of scope.
