# Parity Notes

Baseline: `showcase/packages/langgraph-python/`.

This document lists demos present in the langgraph-python reference that
are **not** ported to the PydanticAI showcase, with the reason for each
skip. See `manifest.yaml` for the full list of demos that **are** shipped
in this package.

## Skipped demos

- `mcp-apps` — Requires CopilotKit MCP Apps middleware wired to a remote
  MCP server (Excalidraw). The PydanticAI integration exposes tools via
  `agent.to_ag_ui()` and does not yet have a documented MCP-apps path
  through the Python SDK's A2UI middleware as of this writing. Can be
  revisited when `copilotkit-sdk-python` grows first-class MCP client
  support across AG-UI integrations. The `beautiful-chat` and
  `headless-complete` cells are ported with their Excalidraw suggestion
  pills intentionally omitted (the rest of each cell is at parity).

- `agentic-chat-reasoning`, `reasoning-default-render`,
  `tool-rendering-reasoning-chain` — These three demos depend on
  `deepagents.create_deep_agent` to emit reasoning/thinking tokens
  alongside regular tool calls. PydanticAI has its own reasoning model
  support (`OpenAIResponsesModel` with reasoning enabled) but does not
  currently stream reasoning content as AG-UI `THINKING_*` events
  through `agent.to_ag_ui()`. Skipped until that bridge exists; a faked
  version would not reflect the real integration.

- `gen-ui-interrupt`, `interrupt-headless` — Both demos are built on
  LangGraph's `interrupt()` primitive (pauses graph execution mid-tool-
  call and surfaces the payload to the client via `useInterrupt`).
  PydanticAI does not have an equivalent interrupt/resume primitive —
  its tools run to completion. Skipped as framework-specific.

## Parked for future parity

These demos are intentionally not in scope for the PydanticAI package:

- `multimodal`, `auth`, `byoc-hashbrown`, `byoc-json-render`, `voice`,
  `agent-config` — langgraph-python features that the original task brief
  did not list among the portable demos, so they remain out of scope.

## Partial parity — ported with documented gaps

The following demos are in the package but do not ship 100% of the
langgraph-python behaviour:

- `headless-complete` — ported without the Excalidraw-via-MCP
  suggestion (see `mcp-apps` skip above). The reasoning-message branch
  of `use-rendered-messages.tsx` is omitted because `@ag-ui/core@0.0.43`
  (the version pinned in this package) does not export
  `ReasoningMessage` and PydanticAI's AG-UI adapter does not emit
  reasoning content today. All other rendering surfaces (per-tool
  renderers, frontend components, default catch-all) are at parity.

- `beautiful-chat` — ported without the Excalidraw-via-MCP suggestion.
  Shared todo state uses PydanticAI's `StateSnapshotEvent` (emitted on
  `manage_todos` completion) instead of langgraph-python's
  `StateStreamingMiddleware` per-token deltas — the shared todo list
  still syncs, just without per-character streaming animation. All
  other surfaces (A2UI fixed + dynamic, Open Generative UI, HITL,
  frontend tools) are at parity.
