# A2UI (Fixed Schema)

## What This Demo Shows

In the fixed-schema variant of A2UI, the component tree (schema) is
authored ahead of time as JSON and shipped with the backend. The Claude
SDK agent streams only _data_ into the data model at runtime via the
`display_flight` tool. The frontend catalog binds component names from
the JSON schema to real React renderers.

## How to Interact

- "Find me a flight from SFO to JFK on United for $289."

## Technical Details

- Frontend catalog: `./a2ui/catalog.ts`, `./a2ui/definitions.ts`,
  `./a2ui/renderers.tsx`. The `Button` override tracks a local `done`
  state so clicking "Book flight" transitions to "Booked ✓".
- Backend schema: `src/agent/a2ui_schemas/flight_schema.json` (Card →
  Column → Title / Row / AirlineBadge / PriceTag / Button).
- Backend agent: `src/agent/a2ui-fixed-prompt.ts` plus the
  `/a2ui-fixed-schema` route in `src/agent_server.ts` —
  `display_flight` returns an `a2ui_operations` container with
  `create_surface` + `update_components` (the loaded JSON schema) +
  `update_data_model` (the per-call data).
- Runtime route: `src/app/api/copilotkit-a2ui-fixed-schema/route.ts`
  with `a2ui.injectA2UITool: false`.

## Reference

- https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui/fixed-schema
