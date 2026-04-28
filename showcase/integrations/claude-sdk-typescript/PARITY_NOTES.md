# Parity Notes

Baseline: `showcase/integrations/langgraph-python/`.

The Claude Agent SDK (TypeScript) backend is a single pass-through
`agent_server.ts` that forwards AG-UI tool schemas (frontend-registered +
runtime-injected) directly to Claude via the Anthropic Messages API.
Demos whose LangGraph reference depends on primitives the pass-through
does not implement are skipped below.

## New demos (post-PR #4271)

- `byoc-json-render` — Claude system prompt (`src/agent/byoc-json-render-prompt.ts`) instructs the model to emit a `@json-render/react` flat spec; frontend renderer wraps `<Renderer />` in `<JSONUIProvider>` and forwards `children` from the MetricCard registry entry.
- `byoc-hashbrown` — Claude system prompt (`src/agent/byoc-hashbrown-prompt.ts`) emits the hashbrown `{ ui: [...] }` JSON envelope with `data` props as JSON strings, matching the strict hashbrown schema.
- `multimodal` — agent_server routes vision-capable Sonnet for the `/multimodal` endpoint, maps AG-UI `binary` parts directly to Anthropic `image` / `document` blocks (no pypdf flattening needed — Claude reads PDFs natively). Frontend keeps the legacy-shape shim so AG-UI schema validation passes and keeps the LFS-pointer guard in `sample-attachment-buttons.tsx`.
- `voice` — dedicated route mounts `GuardedOpenAITranscriptionService` on the V2 runtime instance (throws a typed auth error mapped to 401 when `OPENAI_API_KEY` is missing). Framework-agnostic port.
- `agent-config` — `forwardedProps` arrives verbatim on `RunAgentInput` at the Claude agent; `agent_server.ts` builds the system prompt from `tone` / `expertise` / `responseLength` per run. No LangGraph `configurable` repacking needed because the pass-through doesn't use LangGraph config semantics.
- `auth` — framework-agnostic port using `createCopilotRuntimeHandler` + `hooks.onRequest` with the shared `DEMO_AUTH_HEADER`; `useDemoAuth` defaults to `true`, `ChatErrorBoundary` catches render-time errors in the signed-out state.

## Skipped demos

- `beautiful-chat` — flagship cell that composes A2UI (dynamic + fixed schema), OpenGenerativeUI, and MCP Apps through a single combined runtime alongside agent-authored tools; porting requires dedicated Claude agent branches for each feature, not a single pass-through.
- `headless-complete` — multi-component chat surface assumes backend-authored tools (`get_weather`, `highlight_note`, `display_stock`) defined in the LangGraph `headless_complete` graph; the pass-through has no equivalent agent.
- `a2ui-fixed-schema` — relies on the backend graph's `display_flight` tool emitting an `a2ui_operations` container via `a2ui.render(...)`; the pass-through agent cannot synthesise that backend-defined tool.
- `tool-rendering-default-catchall` — requires the backend `tool_rendering` graph's mock tools (`get_weather`, `search_flights`, `get_stock_price`, `roll_dice`) so the frontend can render them with zero custom renderers; no equivalent toolset exists on the pass-through.
- `tool-rendering-custom-catchall` — same blocker as `tool-rendering-default-catchall` (backend-authored tool suite).
- `gen-ui-interrupt` — requires LangGraph's `interrupt()` primitive and the `on_interrupt` custom event; Claude Agent SDK and the pass-through have no equivalent.
- `interrupt-headless` — same LangGraph `interrupt()` dependency as `gen-ui-interrupt`.
- `agentic-chat-reasoning` — requires per-token reasoning/thinking stream events on AG-UI; the pass-through does not currently forward Claude extended-thinking blocks as AG-UI reasoning events.
- `reasoning-default-render` — same thinking-stream dependency as `agentic-chat-reasoning`.
- `tool-rendering-reasoning-chain` — same thinking-stream dependency as `agentic-chat-reasoning`.
