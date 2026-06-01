# BYOC: Hashbrown (built-in-agent)

Streaming structured output via `@hashbrownai/react`. The built-in-agent
factory emits a catalog-constrained `{ ui: [...] }` JSON envelope; the
hashbrown `useJsonParser` + `useUiKit` parses it progressively and renders
MetricCard + PieChart + BarChart + DealCard + Markdown.

The agent is forced to JSON-object output via OpenAI's `response_format:
{ type: "json_object" }` (`modelOptions` on the TanStack `chat()` call) so
the parser never has to tolerate code fences or preamble.

- Dedicated route: `/api/copilotkit-byoc-hashbrown`
- Single-route mode (`useSingleEndpoint`)
- Key files: `page.tsx`, `hashbrown-renderer.tsx`, `metric-card.tsx`,
  `charts/`, `suggestions.ts`, `types.ts`,
  `../../api/copilotkit-byoc-hashbrown/route.ts`,
  `../../../lib/factory/byoc-hashbrown-factory.ts`
