# LlamaIndex Parity Notes

This package aligns with `showcase/packages/langgraph-python` in terms of demo coverage. The LlamaIndex package uses **AG-UI workflow routers** (`get_ag_ui_workflow_router`) as its backend primitive. The default router at `/` hosts the shared-tool agent that powers most demos; specialized routers (reasoning, A2UI dynamic/fixed, BYOC json-render, BYOC hashbrown, open-gen-ui, multimodal, voice, agent-config, auth, mcp-apps, tool-rendering-reasoning-chain) live at dedicated subpaths. Per-demo `agent.py` files in the demo directories are thin stubs pointing to the relevant backend module.

## Skipped Demos

The following demos are intentionally skipped because they depend on LangGraph-specific primitives for which LlamaIndex has no analogue, or (for `beautiful-chat`) because the port requires significant design-system duplication best deferred to a dedicated follow-up.

| Demo                 | Missing primitive / reason                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cli-start`          | CLI template only — nothing to port in the dojo.                                                                                                                                                                                                                          |
| `gen-ui-interrupt`   | LangGraph's `interrupt()` primitive + `useLangGraphInterrupt`. LlamaIndex AG-UI has no interrupt/resume primitive.                                                                                                                                                        |
| `interrupt-headless` | Same `interrupt()` primitive dependency as `gen-ui-interrupt`.                                                                                                                                                                                                            |
| `beautiful-chat`     | Deferred: requires a large polished design-system (example-layout, example-canvas, generative-ui charts, suggestion hooks) that mirrors the landing starter; better landed as a dedicated follow-up to keep this PR focused on feature parity rather than UI duplication. |

## Partial Ports

- `agent-config`: The LangGraph graph reads `RunnableConfig.configurable.properties` to recompose the system prompt per turn. `get_ag_ui_workflow_router` does not yet expose the same hook surface, so the LlamaIndex port applies the default profile at startup and surfaces the provider wiring (`<CopilotKitProvider properties={...}>`) for parity of the client-side API. The TS-side runtime route (`src/app/api/copilotkit-agent-config/route.ts`) now mirrors the LangGraph showcase's `AgentConfigLangGraphAgent` with an `AgentConfigHttpAgent` subclass that repacks non-structural `forwardedProps` keys into `forwardedProps.config.configurable.properties`, so the wire contract is identical across frameworks and a Python-side recomposer can drop in without further frontend changes. Dynamic per-turn recomposition on the Python side is tracked as a follow-up.
- `multimodal` (Python side): The frontend LFS-pointer guard and sample-button magic-byte validation are ported verbatim from the LangGraph showcase, so bundled samples always fail loudly when LFS isn't materialised on the deploy. The Python `multimodal_agent.py` does NOT yet flatten PDF `document` parts to text via `pypdf` the way the LangGraph middleware does — `get_ag_ui_workflow_router` has no `before_model` middleware hook equivalent. gpt-4o consumes `image` parts natively via llamaindex's adapter; PDF support currently depends on the llamaindex adapter's own handling of `document` parts and may need a router-level preprocessor follow-up if the adapter stops normalising them.

## Ported Demos

Every other demo from the canonical matrix is ported. Each has:

- A per-demo `src/app/demos/<id>/page.tsx`
- A per-demo thin `src/app/demos/<id>/agent.py` stub
- A dedicated backend module under `src/agents/` (or a registration on the shared router)
- An entry in `manifest.yaml` with `highlight` paths that point at the real files
- A `qa/<id>.md` test plan
- An e2e skeleton in `tests/e2e/<id>.spec.ts`
- (For demos that need a distinct runtime surface) a dedicated Next.js route under `src/app/api/copilotkit-*/route.ts`
