# BYOC: Hashbrown — Langroid

Frontend BYOC via `@hashbrownai/react`. The agent emits a single JSON envelope of the form `{"ui": [{tagName: {props: {...}}}, ...]}`; the page wires a custom `messageView.assistantMessage` slot that runs the streaming content through `useJsonParser(content, kit.schema)` and `kit.render(value)` so the dashboard assembles progressively as tokens arrive.

## Topology

- **Page** — `src/app/demos/byoc-hashbrown/page.tsx`. Mounts `<HashBrownDashboard>` (provider that instantiates the `useUiKit` once and shares it via context) and overrides CopilotChat's `messageView.assistantMessage`.
- **Renderer** — `hashbrown-renderer.tsx`. Registers MetricCard + PieChart + BarChart + DealCard + Markdown against `useUiKit`. Charts accept `data` as a JSON-encoded **string** (a hashbrown 0.5.0-beta.4 quirk — the build-time validator rejects example prompts whose attribute values don't match the schema type).
- **Charts** — `charts/{pie-chart,bar-chart,chart-config}.tsx`. Recharts-based, ported from the starter template.
- **Runtime route** — `src/app/api/copilotkit-byoc-hashbrown/route.ts`. Single-agent runtime targeting `${AGENT_URL}/byoc-hashbrown` under the slug `byoc-hashbrown-demo`.
- **Agent** — `src/agents/byoc_hashbrown_agent.py`, mounted at `POST /byoc-hashbrown`. Forces OpenAI's `response_format: json_object` mode and streams the result as a single AG-UI `TEXT_MESSAGE` triple. The system prompt includes a worked example to lock in the single-key-per-entry nesting (`{tagName: {props: {...}}}`) — without it, the model frequently emits flatter shapes the parser rejects.

## Why JSON-stringified `data`?

Hashbrown 0.5.0-beta.4's build-time prompt validator type-checks JSX attribute values against the component's schema. `data='[{"label":"A","value":1}]'` is a string literal that doesn't match `s.streaming.array(...)`, so the example fails validation. Modeling `data` as `s.string(...)` and JSON-parsing inside the chart wrapper sidesteps the validator entirely, and since the LLM streams JSON as text anyway, the round-trip cost is zero.
