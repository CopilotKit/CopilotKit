# Declarative Generative UI (A2UI — Dynamic Schema)

A dedicated A2UI cell where the agent dynamically composes a UI per turn
using a registered frontend catalog.

## How it differs from Agno's existing `generate_a2ui` tool

The Agno main agent (`src/agents/main.py`) ships a `generate_a2ui` tool
that uses an internal hardcoded catalog ID
(`copilotkit://app-dashboard-catalog`, see
`shared/python/tools/generate_a2ui.py`). It works for the main agent's
demos but ignores any frontend catalog the user registers via
`<CopilotKit a2ui={{ catalog }}>` — the catalog ID is baked into the
tool schema's description.

This demo runs against a **separate** Agno agent
(`src/agents/a2ui_dynamic_agent.py`) on its own AGUI interface
(`/declarative-gen-ui/agui`) and a dedicated runtime route
(`/api/copilotkit-declarative-gen-ui`). The dedicated agent's
`generate_a2ui` tool reads the registered client catalog from
`run_context.session_state["copilotkit"]["context"]` (the runtime A2UI
middleware injects it automatically) and feeds it as the system prompt
to the secondary OpenAI client. So the agent stays in sync with whatever
catalog the frontend registers.

## Topology

```
<CopilotKit a2ui={{ catalog: myCatalog }}>          (frontend catalog)
        │
        ▼
/api/copilotkit-declarative-gen-ui                  (runtime: injectA2UITool: false)
        │  HttpAgent
        ▼
http://localhost:8000/declarative-gen-ui/agui       (Agno AGUI interface)
        │
        ▼
a2ui_dynamic_agent.py                               (owns generate_a2ui tool)
        │  secondary OpenAI client → render_a2ui
        ▼
{ "a2ui_operations": [ create_surface, update_components, update_data_model ] }
```

The runtime sets `injectA2UITool: false` because the agent owns the tool
itself. The A2UI middleware still detects the `a2ui_operations` container
in the tool result and forwards the operations to the registered
frontend catalog renderer.

## Files

- `page.tsx` — provider + suggestions
- `a2ui/catalog.ts` — wires definitions × renderers via `createCatalog`
- `a2ui/definitions.ts` — Zod schemas + descriptions for the LLM
- `a2ui/renderers.tsx` — branded React components
- `src/agents/a2ui_dynamic_agent.py` — Agno agent with `generate_a2ui`
- `src/app/api/copilotkit-declarative-gen-ui/route.ts` — runtime route
