# Declarative Generative UI (A2UI — Fixed Schema)

The component tree (schema) is authored ahead of time as JSON
(`src/agents/a2ui_schemas/flight_schema.json`) and shipped with the
backend. The agent only streams _data_ into the data model at runtime
via the `display_flight` tool — **no secondary LLM call**. The frontend
catalog (`./a2ui/catalog.ts`) pins each component name in the schema to
a real React renderer.

## How it differs from Agno's existing `generate_a2ui` tool

The Agno main agent's `generate_a2ui` tool (in `src/agents/main.py`)
runs a _secondary_ OpenAI client to design the component tree per turn
(dynamic-schema flavor). This demo is the opposite: the schema is
fixed, the LLM only fills in the data, and the tool emits an
`a2ui_operations` container directly without a secondary LLM call. That
makes this flavor faster and cheaper than the dynamic flavor.

## Topology

```
<CopilotKit a2ui={{ catalog: fixedCatalog }}>       (frontend catalog)
        │
        ▼
/api/copilotkit-a2ui-fixed-schema                   (runtime: injectA2UITool: false)
        │  HttpAgent
        ▼
http://localhost:8000/a2ui-fixed-schema/agui        (Agno AGUI interface)
        │
        ▼
a2ui_fixed_agent.py                                 (owns display_flight tool)
        │  loads flight_schema.json at startup
        ▼
{ "a2ui_operations": [ create_surface, update_components: <FLIGHT_SCHEMA>, update_data_model: { origin, destination, airline, price } ] }
```

The runtime sets `injectA2UITool: false` because the agent owns its own
rendering tool. The A2UI middleware detects the `a2ui_operations`
container in the tool result and streams the surface to the registered
frontend catalog renderer.

## Files

- `page.tsx` — provider + suggestions
- `a2ui/catalog.ts` — wires definitions × renderers via `createCatalog`
- `a2ui/definitions.ts` — Zod schemas (fields with `path` bindings use a
  `string | { path: string }` union so the A2UI binder resolves data-
  model paths at render time)
- `a2ui/renderers.tsx` — branded React components (Title, Airport, …,
  plus a stateful Button override)
- `src/agents/a2ui_fixed_agent.py` — Agno agent with `display_flight`
- `src/agents/a2ui_schemas/flight_schema.json` — fixed component tree
- `src/agents/a2ui_schemas/booked_schema.json` — sibling schema kept
  for when the SDK exposes per-button action handlers (matches the
  langgraph-python reference)
- `src/app/api/copilotkit-a2ui-fixed-schema/route.ts` — runtime route
