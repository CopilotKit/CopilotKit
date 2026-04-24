# LlamaIndex Parity Notes

This package aligns with `showcase/packages/langgraph-python` in terms of demo coverage. The LlamaIndex package uses a **single shared AG-UI workflow router** (`get_ag_ui_workflow_router`) exposing all tools through one backend agent on port 8000, whereas langgraph-python uses **per-demo Python agent modules**. Per-demo `agent.py` files in this package are thin stubs that point to the shared router in `src/agents/agent.py`.

## Skipped Demos

The following demos are intentionally skipped in this package because they rely on framework-specific primitives that LlamaIndex's AG-UI integration does not support, or they require a distinct runtime surface that is out of scope for the shared-router architecture.

| Demo | Reason |
| --- | --- |
| `cli-start` | CLI template only; nothing to port in the dojo. |
| `gen-ui-interrupt` | Uses LangGraph-specific `interrupt()` primitive + `useLangGraphInterrupt` — no equivalent in LlamaIndex AG-UI. |
| `interrupt-headless` | Same LangGraph-specific interrupt dependency as `gen-ui-interrupt`. |
| `mcp-apps` | Requires MCP client wiring through a dedicated runtime route with an MCP transport — out of scope for the shared AG-UI router. |
| `declarative-gen-ui` | Depends on CopilotKit's `a2ui.catalog` provider wiring + dynamic `render_a2ui` tool injection that is tightly coupled with the LangGraph runtime's middleware; not exercised against LlamaIndex. |
| `a2ui-fixed-schema` | Same A2UI catalog provider dependency as `declarative-gen-ui`. |
| `byoc-hashbrown` | Requires a dedicated runtime route that streams typed structured output via `@hashbrownai/react`'s SSE adapter — architectural mismatch with the shared AG-UI `/run` backend. |
| `byoc-json-render` | Requires a dedicated runtime route streaming hierarchical JSON UI — architectural mismatch with shared AG-UI backend. |
| `beautiful-chat` | Requires a dedicated runtime route with tool-call-driven generative-UI tied to a custom catalog; composable but deferred to match scope of sibling framework packages. |
| `multimodal` | Requires file-upload pipeline and vision-model routing through a dedicated runtime route; out of scope. |
| `auth` | Requires bearer-token onRequest hook on a dedicated runtime route; out of scope. |
| `voice` | Requires STT runtime route + voice model binding; out of scope. |
| `open-gen-ui` | Requires dedicated `copilotkit-ogui` runtime route with open-ended UI generation; architectural mismatch. |
| `open-gen-ui-advanced` | Same open-ended UI route dependency as `open-gen-ui`. |
| `agent-config` | Requires dedicated runtime route that forwards a typed config object into a dynamic system prompt; not portable to the shared LlamaIndex backend. |
| `tool-rendering-reasoning-chain` | LlamaIndex AG-UI router does not expose reasoning-token streaming in the same shape as LangGraph's `reasoning_agent`; skipped to avoid a misleading stub. |
| `agentic-chat-reasoning` | Same reasoning-stream dependency as `tool-rendering-reasoning-chain`. |
| `reasoning-default-render` | Same reasoning-stream dependency. |

## Ported Demos

All other demos from the canonical 36-demo matrix are ported. Each ported demo has:
- A per-demo `src/app/demos/<id>/page.tsx`
- A per-demo thin `src/app/demos/<id>/agent.py` stub pointing to the shared router
- An entry in `manifest.yaml` with `highlight` paths matching the actual files
- A stub `qa/<id>.md`
- An e2e skeleton in `tests/e2e/<id>.spec.ts`
- (Where new agent names are needed) a registration entry in `src/app/api/copilotkit/route.ts`
