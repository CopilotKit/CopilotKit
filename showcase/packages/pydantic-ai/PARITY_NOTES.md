# Parity Notes

Baseline: `showcase/packages/langgraph-python/`.

This document lists demos present in the langgraph-python reference that were
**not** ported to the PydanticAI showcase in the initial parity pass, with a
short reason for each. See `manifest.yaml` for the full list of demos that
**are** shipped in this package.

## Skipped demos

- `beautiful-chat` — Large flagship demo (277-line agent + ~15 supporting frontend files with A2UI catalogs, charts, multi-schema tools, todo state streaming). Deferred to a follow-up PR; the PydanticAI agent_server currently mounts a single agent which does not cleanly host the beautiful-chat-specific StateStreamingMiddleware + per-demo schema data.

- `headless-complete` — Depends on MCP Apps routing (`copilotkit-mcp-apps` route, MCP middleware, Excalidraw MCP server wiring). See `mcp-apps` skip reason below.

- `mcp-apps` — Requires CopilotKit MCP Apps middleware wiring with a remote MCP server (Excalidraw). The PydanticAI integration exposes tools via `agent.to_ag_ui()` and does not have a documented MCP-apps path through the Python SDK's A2UI middleware as of this writing. Can be revisited when `copilotkit-sdk-python` grows first-class MCP client support across AG-UI integrations.

- `agentic-chat-reasoning`, `reasoning-default-render`, `tool-rendering-reasoning-chain` — These three demos depend on `deepagents.create_deep_agent` to emit reasoning/thinking tokens alongside regular tool calls. PydanticAI has its own reasoning model support (`OpenAIResponsesModel` with reasoning enabled) but does not currently stream reasoning content as AG-UI `THINKING_*` events through `agent.to_ag_ui()`. Skipped until that bridge exists; a faked version would not reflect the real integration.

- `gen-ui-interrupt`, `interrupt-headless` — Both demos are built on LangGraph's `interrupt()` primitive (pauses graph execution mid-tool-call and surfaces the payload to the client via `useInterrupt`). PydanticAI does not have an equivalent interrupt/resume primitive — its tools run to completion. Skipped as framework-specific.

- `declarative-gen-ui`, `a2ui-fixed-schema`, `open-gen-ui`, `open-gen-ui-advanced` — These rely on the CopilotKit Python SDK's A2UI helpers (`a2ui.render`, `a2ui.load_schema`, `a2ui.create_surface`) and the runtime-side A2UI middleware. The shared `generate_a2ui` tool already mounted on the PydanticAI agent partially exercises the A2UI path, but faithful per-demo schemas (fixed-schema flight cards, declarative BYOC catalogs, Open Generative UI sandboxed iframes) require dedicated agent wiring that was out of scope for this initial parity pass.

## Parked for future parity

These demos are intentionally not in scope for the PydanticAI package:

- `multimodal`, `auth`, `byoc-hashbrown`, `byoc-json-render`, `voice`, `agent-config` — langgraph-python features that the task brief did not list among the 23 portable demos, so they are considered out of scope for this pass.
