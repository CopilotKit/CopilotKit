# Parity Notes

Baseline: `showcase/integrations/langgraph-python/`.

This document lists demos present in the langgraph-python reference that
are **not** ported to the PydanticAI showcase, with the reason for each
skip. See `manifest.yaml` for the full list of demos that **are** shipped
in this package.

## Recently ported demos

- `gen-ui-tool-based` — Tool-based generative UI with frontend-registered
  `render_bar_chart` and `render_pie_chart` components. The PydanticAI
  agent uses a chart-viz system prompt and relies on the runtime to
  surface frontend-registered tool definitions on each run; no backend
  tool implementations are required because the components handle
  rendering directly on the client.

## New demos (post-PR #4271)

The following demos introduced on main via PR #4271 are now ported:

- `byoc-json-render` — `@json-render/react` BYOC pattern with
  JSONUIProvider wrapping `<Renderer />` and MetricCard children
  forwarding (both post-#4271 fixes preserved).
- `byoc-hashbrown` — `@hashbrownai/react` BYOC pattern. The PydanticAI
  agent emits the post-#4271 JSON envelope
  `{"ui": [{componentName: {"props": {...}}}]}` verbatim.
- `multimodal` — image / PDF attachments. Images flow to GPT-4o vision
  natively via `OpenAIResponsesModel`. PDFs are flattened to inline
  text via `pypdf` inside a PydanticAI `history_processors` hook
  (equivalent to langgraph-python's `_PdfFlattenMiddleware`). The
  frontend's `onRunInitialized` shim and LFS-pointer guard are kept
  intact.
- `voice` — audio transcription. Route reuses the main sales agent at
  the PydanticAI root as a neutral backing agent; the
  `GuardedOpenAITranscriptionService` + direct-instance wiring pattern
  is lifted verbatim from the langgraph-python reference.
- `agent-config` — `forwardedProps` routing. The TS runtime route
  subclasses `HttpAgent` to repack provider `properties` into an AG-UI
  `context` entry tagged `agent-config-properties`; the Python agent's
  dynamic `@agent.system_prompt` reads that entry. Framework-specific
  adaptation vs. langgraph-python's `forwardedProps.config.configurable`
  path — user-visible behaviour is identical.
- `auth` — bearer token auth. Gate is built on
  `createCopilotRuntimeHandler` from `@copilotkit/runtime/v2` with the
  `onRequest` hook, framework-agnostic. Post-#4271 fixes preserved
  (default authenticated, `ChatErrorBoundary`, inverted button labels).

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

- `gen-ui-interrupt`, `interrupt-headless`, `hitl-in-chat`,
  `hitl-in-chat-booking` — All four demos are built on LangGraph's
  `interrupt()` primitive (pauses graph execution mid-tool-call and
  surfaces the payload to the client via `useInterrupt`). PydanticAI
  does not have an equivalent interrupt/resume primitive — its tools
  run to completion. Skipped as framework-specific. (The HITL
  experience in this package is delivered via the `hitl` and
  `hitl-in-app` cells, which use a frontend-tool-driven approval
  pattern that does not require backend interrupts.)

## Parked for future parity

These demos are intentionally not in scope for the PydanticAI package
today — none remain now that the post-#4271 demos listed above have
landed.

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
