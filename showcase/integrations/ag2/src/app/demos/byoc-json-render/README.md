# BYOC json-render (AG2)

Bring-your-own-component frontend rendering via `@json-render/react`. The
AG2 agent emits a single JSON object shaped like a flat `{ root, elements }`
spec; the frontend renders it through a Zod-validated catalog (MetricCard +
BarChart + PieChart).

## Files

- `page.tsx` — `<CopilotKit>` + `<CopilotChat messageView={...}>` swap in
  `JsonRenderAssistantMessage` for the assistant slot.
- `json-render-renderer.tsx` — parses the assistant content into a spec and
  renders with `<JSONUIProvider>` + `<Renderer />`.
- `catalog.ts`, `registry.tsx`, `metric-card.tsx`, `charts/*.tsx` —
  catalog declaration and component bindings.
- `suggestions.ts`, `types.ts` — pre-seeded prompts and shared types.
- `../../api/copilotkit-byoc-json-render/route.ts` — V1 runtime proxy.
- `../../../agents/byoc_json_render_agent.py` — AG2 ConversableAgent locked
  to JSON-object output mode.

## Notes

`response_format={"type":"json_object"}` on the LLM keeps the parser happy;
the page tolerates partial / code-fenced output and falls back to the
default assistant bubble while streaming.
