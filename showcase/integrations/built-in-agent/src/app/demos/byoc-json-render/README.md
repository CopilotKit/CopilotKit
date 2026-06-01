# BYOC: json-render (built-in-agent)

Streaming structured output via `@json-render/react`. The built-in-agent
factory emits a flat `{ root, elements }` spec; the
`JsonRenderAssistantMessage` slot validates it against the Zod-typed
catalog and feeds it to `<Renderer />` against a shared registry.

The agent is forced to JSON-object output via OpenAI's `response_format:
{ type: "json_object" }` (`modelOptions` on the TanStack `chat()` call).

- Dedicated route: `/api/copilotkit-byoc-json-render`
- Single-route mode (`useSingleEndpoint`)
- Key files: `page.tsx`, `json-render-renderer.tsx`, `registry.tsx`,
  `catalog.ts`, `metric-card.tsx`, `charts/`, `suggestions.ts`,
  `types.ts`, `../../api/copilotkit-byoc-json-render/route.ts`,
  `../../../lib/factory/byoc-json-render-factory.ts`
