# AG2 Parity Notes

Status of AG2 showcase demos relative to the langgraph-python canonical set.

## ag2 1.0 migration (2026-07)

The whole backend was migrated from the legacy `autogen` API
(`ConversableAgent` + `LLMConfig` + `ContextVariables`/`ReplyResult`) to
the ag2 1.0 API (`ag2.Agent` + `ag2.config.OpenAIConfig` + `Context`
variables). Key behavioral deltas to re-verify in QA:

- **Reasoning**: ag2 1.0's `AGUIStream` maps model reasoning deltas to
  `REASONING_MESSAGE_*` events natively — the pre-1.0 limitation
  documented in "Reasoning channel" below no longer applies at the
  bridge level. The `reasoning-custom`/`reasoning-default` cells still
  run on the custom `/reasoning` sub-app until re-verified.
- **Shared-state streaming**: 1.0 emits `STATE_SNAPSHOT` automatically
  only at run start/end. State-pattern agents (`gen_ui_agent`,
  `shared_state_read_write`, `subagents`, `agent_config_agent`) now emit
  explicit intermediate snapshots via
  `context.send(AGUIEvent(StateSnapshotEvent(...)))` to preserve live
  per-tool-call UI updates — `shared-state-streaming` in
  `manifest.yaml#not_supported_features` is a candidate for removal
  after QA.
- **Multimodal**: 1.0 maps AG-UI `image`/`document` parts natively
  (PDFs travel as OpenAI file parts — no pypdf flattening). Only the
  legacy `binary` mirror parts still need stripping
  (`_multimodal_normalize.py`, now much smaller).
- **Loop guard**: 1.0 has no `max_consecutive_auto_reply`; the old
  runaway-tool-loop caps were dropped (see the guard-rationale comments
  in the agent modules).

## Ported

### Batch 1 — Frontend variants over the shared Agent

These demos reuse the existing `src/agents/agent.py` (one ag2 `Agent`
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
  `useRenderCustomMessages`). Backend: dedicated ag2
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
  ag2 `Agent`; the runtime route at
  `api/copilotkit-mcp-apps/route.ts` configures
  `mcpApps.servers` pointing at the public Excalidraw MCP server, and
  the runtime middleware injects MCP tools at request time.
- `open-gen-ui`, `open-gen-ui-advanced` — Backends are no-tools
  ag2 `Agent`s (`src/agents/open_gen_ui_agent.py` and
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
  **Reasoning channel does NOT light up — confirmed framework-bridge
  limitation, not a fixture bug.** See the dedicated section below.

### Batch 2 — Dedicated AG2 sub-apps

These demos own their own `Agent`(s) plus FastAPI sub-app
mounted at a named path (`agent_server.py` mounts each one before the
catch-all `/`). The Next.js runtime points an `HttpAgent` at the
matching path so each demo gets its own ContextVariables-backed state
slot, isolated from the shared default agent.

- `shared-state-read-write` — bidirectional shared state via AG2
  `ContextVariables` + `ReplyResult`. Agent calls `get_current_preferences`
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
(b) adopting AG2's `GroupChat` to host multiple specialized agents
behind a single stream with router logic. Both approaches are feasible
but represent a distinct engineering investment and are not a pure port
of the langgraph-python cell.

The following demos fall into that bucket and are **deferred**, not
strictly "missing primitive" skips:

- `agent-config` — needs the agent to re-materialize system prompt from
  forwardedProps on every turn (the ag2 Agent supports this but a
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

## Skipped (missing primitive)

- `gen-ui-interrupt` — requires a LangGraph-style `interrupt()` that
  round-trips a resumable graph pause through the event stream. AG2's
  `human_input_mode` is a synchronous request/reply; it does not resume
  the same run from a persisted checkpoint. Marked as
  `not_supported_features` in `manifest.yaml`; the route renders a stub
  page pointing at `hitl-in-chat` / `hitl-in-app`.
- `interrupt-headless` — same underlying primitive as `gen-ui-interrupt`.
  Marked `not_supported_features`; stub page points at `hitl-in-app` /
  `frontend-tools-async`.

## Reasoning channel — framework-bridge limitation (HISTORICAL, pre-1.0)

> **Superseded by the ag2 1.0 migration.** ag2 1.0's `AGUIStream`
> (`ag2/ag_ui/stream.py`) maps model reasoning deltas to
> `REASONING_MESSAGE_*` events natively, so the analysis below — verified
> against `ag2==0.13.3` — no longer describes the current bridge. Kept
> for history until QA re-verifies the reasoning cells on 1.0.

Applies to `reasoning-custom`, `tool-rendering-reasoning-chain`,
and `reasoning-default`. The custom/built-in `reasoningMessage`
slot is wired correctly, but the AG-UI reasoning channel never lights up
because **AG2's `AGUIStream` bridge cannot emit `REASONING_MESSAGE_*`
events** — it has no reasoning data to emit. This is the same class of
gap as pydantic-ai, not a fixture or wiring bug. Do NOT attempt to fix
it by hacking the aimock fixtures.

Verified against `ag2==0.13.3` / `autogen 0.13.3` (the version the
`requirements.txt` pin resolved to at the time; the pin is now
`ag2[openai,ag-ui]>=1.0.0`).

### What AGUIStream actually emits

`autogen.ag_ui.adapter` (the `AGUIStream` / `run_stream` implementation)
imports and emits only this fixed set of AG-UI event types:

- `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`
- `STATE_SNAPSHOT`
- `TEXT_MESSAGE_START` / `_CONTENT` / `_END` / `_CHUNK`
- `TOOL_CALL_START` / `_ARGS` / `_CHUNK` / `_END` / `_RESULT`

There is **no** `REASONING_MESSAGE_*` import and **no** `THINKING_*`
import anywhere in the adapter. So the question "does it emit
`REASONING_MESSAGE_*`, `THINKING_*`, or nothing?" resolves to **nothing**
— the reasoning channel is entirely absent from the bridge. (Note: even
if it emitted `THINKING_*`, that would be a dead end — `@ag-ui/client`
0.0.52 drops `THINKING_*`; only `REASONING_MESSAGE_*` with
`role:"reasoning"` reaches the UI.)

### Why a custom-synth interceptor is NOT feasible

The agno / claude-sdk-python pattern (synthesize `REASONING_MESSAGE_*`
from the model's native reasoning channel — agno reads
`RunContentEvent.reasoning_content`; claude-sdk-python reads Anthropic's
Messages-API `thinking_delta`, never chat-completions
`delta.reasoning_content`) cannot be applied here, because the reasoning
data never survives into any layer the bridge can see:

1. `AGUIStream` exposes an `event_interceptors` hook, but interceptors
   receive `ServiceResponse` objects (`autogen.agentchat.remote.protocol`).
   `ServiceResponse` has exactly four fields — `message`, `context`,
   `input_required`, `streaming_text` — and **no reasoning field**.
2. Upstream of that, `AgentService` (`agent_service.py`) builds its
   streaming text from an `AsyncIOQueueStream` whose `send()` only
   captures `StreamEvent.content.content` (visible text). The final
   reply comes from `a_generate_oai_reply`, which returns a plain OAI
   message (content + tool_calls).
3. Upstream of _that_, autogen's OpenAI chat-completions client
   (`autogen/oai/client.py`) reads only `choice.delta.content` and
   `choice.delta.tool_calls` from each streaming chunk.
   `choice.delta.reasoning_content` is **never read** in the
   chat-completions path — it is silently dropped at ingestion. (Only the
   separate `responses_v2` / Responses-API client surfaces reasoning via
   `response.reasoning`, and that path does not flow through `AGUIStream`
   either.)

Empirical confirmation: an OpenAI-compatible endpoint that streams
`delta.reasoning_content` (exactly the channel aimock's `reasoning`
fixture field drives) + `delta.content`, driven through a real
`ConversableAgent` + `AGUIStream`, produces:

```
RUN_STARTED: 1
TEXT_MESSAGE_START: 1
TEXT_MESSAGE_CONTENT: 3
TEXT_MESSAGE_END: 1
RUN_FINISHED: 1
REASONING_MESSAGE_START: 0   ← reasoning channel never fires
```

and the assembled reply is just the visible string — the
`reasoning_content` is gone. There is therefore no reasoning data for a
custom interceptor to synthesize from; manufacturing reasoning text would
be a demo fabrication, which we explicitly do not do.

### What a real fix requires (upstream, in AG2)

A genuine fix must add reasoning support inside autogen itself, end to
end:

1. `autogen/oai/client.py` streaming consumer must read
   `choice.delta.reasoning_content` and accumulate it alongside content.
2. A reasoning carrier must be threaded through `StreamEvent` →
   `AsyncIOQueueStream` → `AgentService`, and `ServiceResponse` must gain
   a reasoning field (or a dedicated streaming reasoning chunk type).
3. `autogen/ag_ui/adapter.py::run_stream` must import and emit
   `REASONING_MESSAGE_START` / `_CONTENT` / `_END` (role `"reasoning"`)
   when reasoning deltas arrive — analogous to its existing
   `TEXT_MESSAGE_*` handling.

Until AG2 ships that, the showcase reasoning slot for AG2 demos will
render empty/skeletal. The cells remain valuable for exercising the slot
plumbing and (for `tool-rendering-reasoning-chain`) the multi-tool chain.
