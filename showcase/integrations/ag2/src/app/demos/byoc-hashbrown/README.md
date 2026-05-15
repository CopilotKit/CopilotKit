# BYOC Hashbrown (AG2)

Bring-your-own-component frontend rendering via `@hashbrownai/react`'s
`useUiKit` + `useJsonParser`. The AG2 agent emits a streaming JSON envelope
constrained to a small catalog (MetricCard + PieChart + BarChart +
DealCard + Markdown), and the kit assembles it progressively into a sales
dashboard.

## Files

- `page.tsx` — `<CopilotKit>` + `<CopilotChat messageView={...}>` swap in
  `HashBrownAssistantMessage` for the assistant slot.
- `hashbrown-renderer.tsx` — `useSalesDashboardKit` registers the catalog;
  `AssistantMessageRenderer` parses streaming JSON via `useJsonParser`.
- `metric-card.tsx`, `charts/bar-chart.tsx`, `charts/pie-chart.tsx` —
  presentational components.
- `suggestions.ts` — pre-seeded prompt pills.
- `../../api/copilotkit-byoc-hashbrown/route.ts` — V1 runtime that proxies
  to a dedicated AG2 mount.
- `../../../agents/byoc_hashbrown_agent.py` — AG2 ConversableAgent with
  `response_format={"type":"json_object"}` and a strict system prompt.

## Notes

The AG2 agent locks the model into JSON-object output mode so the streaming
parser never sees prose preamble or code fences.
