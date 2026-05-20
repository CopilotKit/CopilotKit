# Beautiful Chat (Agno port — simplified)

## What this demo shows

A polished, landing-style chat surface backed by the shared Agno
`agentic_chat` agent. The page is split into two columns:

- **Left** — an example app surface with a couple of demonstration charts
  (weekly sessions bar chart, surface-mix pie chart). Useful as a target
  for the assistant to talk about.
- **Right** — a `CopilotChat` panel skinned with the brand gradient,
  rounded card, and seeded suggestion pills.

## How to interact

Use one of the seeded suggestion pills, or ask the assistant something
like:

- "Summarize the dashboard on the left."
- "Plan a 3-day Tokyo trip for a solo traveler."
- "Draft a launch email for our new chat feature."

## Adaptation note

The canonical `langgraph-python` beautiful-chat ships a much larger
surface — a full A2UI demonstration catalog, a declarative-generative-UI
catalog, per-tool renderers wired through `injectA2UITool: false`, custom
theming, and a `GenerativeUIExamples` hook. That ecosystem depends on
A2UI middleware that the Agno integration does not yet expose.

The Agno port follows the simplified `spring-ai` pattern: the polished
chat shell over the shared Agno chat agent, with suggestion pills and a
few static charts on the side. The cosmetic layer (suggestions, theming,
composer skin, side canvas) lives entirely on the frontend; the runtime
stays on the shared `/api/copilotkit` endpoint.

## Related

- Backend agent: `src/agents/main.py` (the same one `agentic-chat` uses)
- Charts: re-uses `src/app/demos/byoc-json-render/charts/` for the
  Recharts-backed `BarChart` and `PieChart` components.
- Full reference: `showcase/integrations/langgraph-python/src/app/demos/beautiful-chat/`
