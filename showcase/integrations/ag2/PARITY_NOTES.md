# AG2 Parity Notes

Status of AG2 showcase demos relative to the langgraph-python canonical set.

## Ported

### Batch 1 — Frontend variants over the shared Agent

These demos reuse the existing `src/agents/agent.py` (one AG2 `Agent`
wrapped with `AGUIStream`). The runtime route registers each agent name,
all pointing to the same HTTP backend.

- `prebuilt-sidebar` — `<CopilotSidebar />` docked layout
- `prebuilt-popup` — `<CopilotPopup />` floating launcher
- `chat-slots` — slot-overridden `<CopilotChat />` (welcomeScreen, disclaimer, assistantMessage)
- `chat-customization-css` — scoped CSS theming of built-in classes
- `headless-simple` — bespoke chat built on `useAgent` / `useComponent`
- `readonly-state-agent-context` — `useAgentContext` read-only context
- `reasoning-default` — built-in `CopilotChatReasoningMessage` (no custom slot)
- `tool-rendering-default-catchall` — `useDefaultRenderTool()` (built-in card)
- `tool-rendering-custom-catchall` — single branded wildcard renderer
- `frontend-tools` — `useFrontendTool` with sync handler (change_background)
- `frontend-tools-async` — `useFrontendTool` with async handler (notes-card)
- `hitl-in-app` — async `useFrontendTool` + app-level modal (approval-dialog)

### Previously ported (kept)

- `agentic-chat`, `hitl-in-chat`, `tool-rendering`, `gen-ui-tool-based`,
  `gen-ui-agent`, `shared-state-streaming`

### Batch 3 — Headless complete + manifest-only entries

- `cli-start` — informational manifest entry (copy-paste starter command).
- `gen-ui-tool-based` — already shipped; manifest entry added.
- `headless-complete` — TRULY headless chat re-composed from low-level
  hooks (`useRenderToolCall`, `useRenderActivityMessage`,
  `useRenderCustomMessages`). Backend: dedicated AG2
  `Agent` (`agents/headless_complete.py`) mounted at
  `/headless-complete/` with `get_weather` + `get_stock_price` tools;
  `highlight_note` is registered on the frontend via `useComponent`.

### Batch 4 — A2UI / OGUI / MCP + reasoning ports (this batch)

Each demo gets its own AG2 sub-app mounted at a named path, plus
(where required) its own dedicated `/api/copilotkit-*` runtime route so
the runtime middleware config doesn't leak into other cells.

- `declarative-gen-ui` — A2UI Dynamic Schema. Backend
  (`src/agents/a2ui_dynamic.py`) owns the `generate_a2ui` tool, which
  invokes a secondary OpenAI client bound to `render_a2ui` and returns
  an `a2ui_operations` container. Runtime route at
  `api/copilotkit-declarative-gen-ui/route.ts` with
  `a2ui.injectA2UITool: false`.
- `a2ui-fixed-schema` — A2UI Fixed Schema. Backend
  (`src/agents/a2ui_fixed.py`) ships `flight_schema.json` and exposes a
  `display_flight(origin, destination, airline, price)` tool that emits
  `a2ui_operations` directly. Runtime route at
  `api/copilotkit-a2ui-fixed-schema/route.ts` with
  `a2ui.injectA2UITool: false`.
- `mcp-apps` — Backend (`src/agents/mcp_apps_agent.py`) is a no-tools
  `Agent`; the runtime route at
  `api/copilotkit-mcp-apps/route.ts` configures
  `mcpApps.servers` pointing at the in-process AG2 MCP server
  (`src/agents/mcp_apps_server.py`, an `ag2.mcp` `MCPApp` serving the
  `ui://ag2/diagram` resource and a `create_view` tool, mounted by
  `agent_server.py` at `/mcp-apps-server`), and the runtime middleware
  injects MCP tools at request time. It needs the `ag2[mcp]` extra.
- `open-gen-ui`, `open-gen-ui-advanced` — Backends are no-tools
  `Agent`s (`src/agents/open_gen_ui_agent.py` and
  `src/agents/open_gen_ui_advanced_agent.py`). Shared runtime route at
  `api/copilotkit-ogui/route.ts` enables
  `openGenerativeUI: { agents: [...] }` so the runtime middleware
  converts streamed `generateSandboxedUi` tool calls into
  `open-generative-ui` activity events.
- `reasoning-custom`, `tool-rendering-reasoning-chain` — Frontend
  ports of the LangGraph reasoning cells. The custom `reasoningMessage`
  slot is wired exactly as in the canonical reference. The tool chain
  (`tool-rendering-reasoning-chain` backend at
  `src/agents/tool_rendering_reasoning_chain.py`, mounted at
  `/tool-rendering-reasoning-chain/`) still exercises end-to-end.
  The reasoning channel is native in AG2 1.x; see the section below.

### Batch 2 — Dedicated AG2 sub-apps

These demos own their own `Agent`(s) plus FastAPI sub-app
mounted at a named path (`agent_server.py` mounts each one before the
catch-all `/`). The Next.js runtime points an `HttpAgent` at the
matching path so each demo gets its own `ctx.variables`-backed state
slot, isolated from the shared default agent.

- `shared-state-read-write` — bidirectional shared state via AG2
  `ctx.variables`, with mid-run snapshots from `agents/_state.py::publish_state`. Agent calls `get_current_preferences`
  to read UI-written prefs and `set_notes` to write back.
- `subagents` — supervisor `Agent` that delegates to three
  sub-`Agent`s (research/writing/critique) exposed as tools;
  each delegation appends to `delegations` in shared state for the live
  log UI.

## Deferred (require per-demo agent specialization)

AG2's AG-UI integration mounts a single `AGUIStream` over one
`Agent` at the FastAPI root. Achieving per-demo specialized
behavior (tailored system prompts, dedicated tool sets, backend-owned
A2UI tools, MCP integration, vision input, structured-output BYOC, etc.)
requires adding additional Python agent modules AND either (a) mounting
each as its own ASGI app at a distinct path and pointing a dedicated
`HttpAgent({ url })` at it from a per-demo Next.js runtime route, or
(b) routing between specialized agents behind a single stream. Both approaches are feasible
but represent a distinct engineering investment and are not a pure port
of the langgraph-python cell.

The following demos fall into that bucket and are **deferred**, not
strictly "missing primitive" skips:

- `agent-config` — needs the agent to re-materialize system prompt from
  forwardedProps on every turn (AG2 `Agent` supports this but a
  dedicated runtime wiring is required).
- `auth` — pure runtime `onRequest` hook demo; dedicated `/api/copilotkit-auth`
  route; agent stays unchanged. Straightforward but requires a new route.
- `byoc-hashbrown`, `byoc-json-render` — streaming structured-output BYOC
  with Zod-validated catalogs; each has its own runtime route, catalog,
  renderer, and supporting components.
- `multimodal` — vision-capable AG2 agent + dedicated `/api/copilotkit-multimodal`.
- `voice` — frontend voice STT; needs dedicated `/api/copilotkit-voice` and
  the lazy-init agent shape from langgraph-python.

## Shipped — wave 2 follow-up

- `beautiful-chat` — simplified port: combines A2UI Dynamic + Open
  Generative UI on a dedicated runtime (`/api/copilotkit-beautiful-chat`).
  MCP Apps is intentionally out-of-scope (covered separately by
  `/demos/mcp-apps`); the canonical reference's app-mode toggle / todos
  canvas is also not ported. Frontend reuses the catalog from
  `/demos/declarative-gen-ui` to avoid duplication.
- `hitl-in-chat-booking` — manifest alias to the existing `hitl-in-chat`
  cell. The langgraph reference itself aliases the booking variant to
  the same `/demos/hitl-in-chat` route; AG2's `useHumanInTheLoop`
  surface (TimePickerCard) is functionally equivalent for the booking
  flow. NOT a missing-primitive case — the earlier "skipped" entry was
  incorrect (it conflated `hitl-in-chat-booking` with the
  `useInterrupt`-driven flow, which it isn't).

## Skipped (not supported)

Checked against AG2 1.1.2; these match `not_supported_features` in
`manifest.yaml`.

- `gen-ui-interrupt`, `interrupt-headless` — implemented as frontend-tool
  adaptations (`useHumanInTheLoop`; the backend `interrupt_agent` has no tools
  and the client supplies `schedule_meeting`). AG2 1.x does have a native
  interrupt primitive (`ctx.input()` / `approval_required` surface as AG-UI
  interrupt outcomes a client resumes), but the shared `useInterrupt` frontend
  path is not wired to it, so the LangGraph-style demo stays unsupported.
- `shared-state-streaming` — needs per-token state deltas from streamed
  tool-call arguments (predictive state). AG2's `AGUIStream` emits full
  `STATE_SNAPSHOT`s at tool boundaries only, so the document cannot stream
  token by token.

## Reasoning channel

Supported on AG2 1.x. `AGUIStream` maps model reasoning to AG-UI
`REASONING_START` / `REASONING_MESSAGE_*` / `REASONING_END` events, so the
built-in `CopilotChatReasoningMessage` (`reasoning-default`) and the custom
`reasoningMessage` slot (`reasoning-custom`, `tool-rendering-reasoning-chain`)
fill in. The agents use the Responses API (`OpenAIResponsesConfig`); the
reasoning stream is built from reasoning _summary_ text, which OpenAI only
returns when the request sets `reasoning.summary`. The `OpenAIResponsesConfig`
in AG2 1.1.2 has no such option, so both reasoning backends (`reasoning_agent.py`
and `tool_rendering_reasoning_chain.py`) take their config from
`src/agents/_reasoning_summary.py`, which adds it to the request body through
the config's `http_client`. The aimock Responses handler emits reasoning
summaries, so the fixtures drive the slot deterministically.

Verified against `ag2` 1.1.2 (`requirements.txt`: `ag2[openai,ag-ui,mcp]==1.1.2`).
The compat patches (`_reasoning_summary.py`, `_usage_compat.py`) target that
exact version; re-check them when the pin moves.

## Known gaps on AG2 1.x

- AG2 1.x has no `max_consecutive_auto_reply`. `src/agents/_loop_cap.py`
  replaces it with a middleware that allows at most N model calls per run and
  then ends the turn with a short text reply; every agent sets it, with the
  same N its 0.x cap had. Unlike the 0.x option it counts model calls, not
  auto-replies, so a single model call that requests several tools in parallel
  still counts once.
- `byoc-hashbrown` / `byoc-json-render` no longer set
  `response_format: json_object` (the Responses config has no such option) and
  rely on the system prompt for JSON output.
- aimock's Responses handler omits token-detail objects that AG2's usage mapper
  dereferences; `src/agents/_usage_compat.py` replaces the mapper with a
  None-safe one.
- AG2 1.x builds its OpenAI client on `httpx2`; `_header_forwarding.py` patches
  both `httpx` and `httpx2` so `x-aimock-context` reaches the LLM call.
