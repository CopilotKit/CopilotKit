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
- **Loop guard**: 1.0 has no `max_consecutive_auto_reply`, so the 0.x
  per-agent caps (4–15 depending on the demo) were dropped. Nothing in
  the framework bounds a tool loop now; what actually stops one is the
  system prompt's termination rules, plus — for the recorded showcase
  cells — the fixture's `hasToolResult: true` anchor, which answers the
  post-tool turn with content instead of re-routing to the same tool.
  This matters operationally: a runaway loop floods Railway's log stream
  (500 logs/sec rate-limit), starves health probes, and gets the service
  killed by the watchdog. Keep termination rules explicit in any new
  agent's prompt.

### Dynamic A2UI on ag2's own stack (2026-08)

`declarative-gen-ui` previously delegated all UI generation to the CopilotKit
JS middleware: the Python `generate_a2ui` tool was a stub whose body only
raised, and `a2ui.injectA2UITool: true` let the middleware intercept the
toolcall and drive its own secondary `render_a2ui` LLM pass. The cell worked,
but exercised none of ag2's A2UI code.

It is now driven by ag2's own A2UI stack:

- `src/agents/a2ui_dynamic.py` is an `A2UIServer` (which **is** the ASGI app —
  `agent_server.py` mounts it directly) with `transport=AgUiTransport()`.
  ag2 injects the catalog + rules into the prompt, validates the model's
  `<a2ui-json>` block against the catalog (retrying, then degrading to prose),
  and `AgUiTransport` emits the validated operations as one AG-UI
  `a2ui-surface` activity carrying `a2ui_operations`.
- `src/agents/a2ui_schemas/declarative_gen_ui_catalog.json` is a server-side
  mirror of the 11 components the page renders. Its `$id` is
  `declarative-gen-ui-catalog` — **exactly** the id the frontend registers
  (`a2ui/catalog.ts`); any other value renders as "Catalog not found".
- The route now sets `a2ui.injectA2UITool: false` — the backend owns
  generation, so the middleware must not inject a tool or run a second pass.
  (`defaultCatalogId` is kept for parity but is inert here: it is only
  consulted where the middleware synthesises a surface from a `render_a2ui`
  toolcall, and this backend emits none.)
- `showcase/aimock/d6/ag2/gen-ui-declarative.json` was re-authored from
  `render_a2ui` toolcalls to prose + an `<a2ui-json>` block. The component
  trees are carried over verbatim, so the cell renders as before.

**Known cost — two hand-synced files.** The JSON catalog duplicates
`src/app/demos/declarative-gen-ui/a2ui/definitions.ts` in another language.
A change to either MUST be mirrored in the other: a prop that exists only in
`definitions.ts` fails server-side validation and silently degrades the surface
to plain prose, i.e. a RED cell with no visible cause. A generator would be
better; two files is the honest cost today.
`tests/python/test_a2ui_dynamic_uses_ag2_stack.py` asserts the component-name
sets stay equal and re-validates every fixture tree, so drift fails in CI
rather than on the dashboard.

**ag2 1.0.1 asymmetry worth knowing.** On a component-name collision between
the basic and custom catalogs, `A2UISchemaManager._get_active_catalog()` (the
schema registry) lets the **custom** definition win, but
`get_component_schemas()` lets the **basic** one win. Validation resolves
components through the registry (`{catalog_id}#/components/{name}`), so the
custom override is what actually applies — the overridden `Card`/`Row`/
`Column`/`Text` behave correctly. Do not read `get_component_schemas()` as
the effective schema.

**Verification.** Custom-catalog ref resolution and validation were proven
directly (bare non-URI `$id` resolves; overrides win; 6 deliberately invalid
trees are all rejected, so validation is not vacuous). All 4 fixture prompts
were then driven through the real mount against aimock: HTTP 200, no
`RUN_ERROR`, `activity_type: a2ui-surface`, `a2ui_operations` carrying
`"catalogId": "declarative-gen-ui-catalog"`, no raw `<a2ui-json>` leaking into
the prose. `/`, `/a2ui-fixed-schema/` and `/beautiful-chat/` were
regression-probed unchanged. CopilotKit↔ag2 compatibility was checked at the
wire level: ag2's `ActivitySnapshotEvent` serialises to exactly the fields
`@ag-ui/core`'s `ActivitySnapshotEventSchema` requires
(`type`/`messageId`/`activityType`/`content`/`replace`), the renderer's
`activityType: "a2ui-surface"` + `A2UI_OPERATIONS_KEY` match ag2's transport
constants verbatim, an explicit `injectA2UITool: false` is respected by
`agent-utils.ts` even when the provider forwards a catalog, and the JS
middleware passes a backend-emitted `ACTIVITY_SNAPSHOT` through untouched.

**Browser render — verified.** `bin/showcase test ag2:declarative-gen-ui --d6
--direct` could NOT run in the dev environment (the `--profile infra` build
needs `python:3.12.13` from Docker Hub, which returns `EOF` here). The render
was instead verified on a minimal stack — aimock + local `next dev` + local
`uvicorn`, no Docker Hub — driving Chromium through all 4 demo pills with
`x-aimock-context: ag2` injected into the browser context, asserting the same
testids and `minCounts` deltas the shared probe asserts
(`harness/src/probes/scripts/d5-gen-ui-declarative.ts`). All 4 pills green:
metric×4 + pie + bar; card + bar + dataTable; card×3 + metric×3 + badge×3;
card + pie + infoRow×7. No "Catalog not found", no `<a2ui-json>` in the DOM.
Note for whoever screenshots this cell: Recharts animates the pie in over
~2 s (0 `<path>`s at mount, 4 at +2 s), so a snapshot taken the moment the
surface mounts shows an empty pie card. That is animation, not a defect.
This is a faithful reproduction of the shared probe's assertions, not the
harness probe itself — the CI run remains the authoritative gate.

**Not exercised by any fixture:** the `refresh_dashboard` `@a2ui_action` is
declared (so the LLM may render the button and a click runs server-side without
invoking the agent), but no fixture tree draws a button — adding one would make
this cell's screenshot diverge from its siblings.

### Six built-but-unreachable cells accounted for (2026-08)

Six cells had a backend, a frontend, a shared e2e probe and a fixture on disk
yet never appeared on the dashboard. Nothing failed — they were simply absent,
which is why this went unnoticed. Two of them were additionally broken.

Three are now shipped. The other three are reasoning cells: they are routed
under `demos:` so the manifest accounts for them, but held in
`not_supported_features` rather than published — see the table.

**How a cell actually ships.** `determineCellStatus`
(`harness/src/shared/catalog/catalog-flatten.ts`) requires the id in BOTH
`manifest.yaml#features` AND a `demos:` entry carrying a `route:`. Declaring
only one yields `unshipped` — invisible, silently. `features:` is the gate;
`demos:` alone does nothing. This asymmetry is the whole cause of the gap.

| Cell                             | What was wrong                                                                                                                                                                                                       | Outcome                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `shared-state-read`              | absent from `features:` + `demos:`                                                                                                                                                                                   | **shipped**                            |
| `declarative-hashbrown`          | unregistered **and** 404: page requests `/api/copilotkit-declarative-hashbrown`, directory was `copilotkit-byoc-hashbrown`; agent key was `byoc-hashbrown-demo` while the page asks for `declarative-hashbrown-demo` | **shipped**                            |
| `declarative-json-render`        | unregistered **and** 404: same directory mismatch (agent key `byoc_json_render` was already correct)                                                                                                                 | **shipped** — but see the caveat below |
| `reasoning-default`              | absent from `features:` + `demos:`                                                                                                                                                                                   | routed, kept `not_supported`           |
| `reasoning-custom`               | absent from `features:` + `demos:`                                                                                                                                                                                   | routed, kept `not_supported`           |
| `tool-rendering-reasoning-chain` | had `demos:` + `route:`, never added to `features:` when its `not_supported_features` flag was dropped during the 1.0 migration — so removing the flag silently left it `unshipped`                                  | flag restored, kept `not_supported`    |

**Why the reasoning cells are routed but not published.** Routing them satisfies
the manifest guard — every demo directory is accounted for — without changing
what the dashboard publishes. The three reasoning flags were ALREADY in
`not_supported_features` before this work, carrying a note that they are
candidates for removal "once QA re-verifies the demos against ag2>=1.0.0". That
re-verification is the reasoning rewrite, and it is deliberately held back from
this branch, so the flags stay exactly as they were. `reasoning-default` and
`reasoning-custom` were added to the same list for consistency with the three
already there.

Do NOT read this as "we only publish cells we can prove" — that standard is not
what this manifest applies, and the very next paragraph is the counter-example.
`declarative-json-render` is published while being no better observed than the
reasoning cells; it is published because 15 other integrations declare it and
diverging here would be a per-integration variation with nothing behind it. The
honest summary is that probe coverage, not backend capability, is what separates
these two groups, and the split is historical rather than principled.

**Caveat on `declarative-json-render`.** Its cell status rolls up from the
shared `byoc` D5 featureType (`live-status.ts`, `d5-feature-mapping.ts` map both
declarative cells onto it), and `d5-byoc.ts#preNavigateRoute` prefers the
hashbrown route whenever both are declared. So the cell inherits hashbrown's
result and the json-render page itself is **never actually probed** — here or in
any other integration. `buildTurns()` sends `HASHBROWN_PILL` unconditionally
regardless of the route it landed on, which its own comment concedes
("always use the hashbrown pill … json-render-only integrations would need a
separate featureType split"). Running the cell explicitly
(`bin/showcase test ag2:declarative-json-render`) narrows the route to
json-render while the pill stays hashbrown, and it goes RED on the renderer
assertion. A fixture cannot fix this: aimock matches on
`userMessage` × `context`, and both cells share both. The fix belongs in the
shared probe, i.e. upstream of this integration.

`aimock/d6/ag2/declarative-json-render.json` was nonetheless added, mirroring
the spring-ai / strands / strands-typescript layout (same three responses, only
`context` differs). It matches nothing today — the probe never sends those pills
— and changes no cell status; it is there so ag2 needs no fixture work once the
probe is fixed. `byoc.json` stays scoped to `declarative-hashbrown`, as its own
`_meta` says, and answers with the legacy `render_dashboard` toolcall shape that
the json-render renderer cannot parse.

**Verified, not assumed.** RED captured before the fix on the real probe:
both declarative cells failed with the browser's own network log showing
`GET /api/copilotkit-declarative-{hashbrown,json-render}` → **404** and console
`Agent declarative-hashbrown-demo not found` / `Agent byoc_json_render not
found`. The API route directories were renamed to `copilotkit-declarative-*`
(matching the byte-identical shared frontend, which cannot be adapted), the
hashbrown agent key corrected, and both `endpoint:` values updated. The AG2-side
mount paths (`/byoc-hashbrown/`, `/byoc-json-render/`) are internal and
deliberately unchanged.

**⚠️ Renaming an API route directory REQUIRES an image rebuild — `--rebuild`.**
This cost real time and will trap the next person, because every signal looks
right. `docker-compose.local.yml` bind-mounts `./integrations/ag2/src:/app/src`,
so `docker exec showcase-ag2 ls /app/src/app/api` shows the NEW directory names
immediately. But Next.js serves the **production build**: `.next` is compiled
inside the image and is in `.dockerignore`, so the compiled route table still
holds the OLD paths and the cell keeps returning 404. The bind mount makes
Python-side edits live while silently masking that the frontend was never
rebuilt. Symptom to recognise: probe RED with `status: 404` on the new path while
a `curl` of the old path returns 400 (route exists, body invalid). Fix:
`bin/showcase test <slug>:<cell> --d6 --direct --rebuild`; confirm via
`docker images --format '{{.CreatedAt}}' showcase-ag2:local` actually moving.

**Guard.** `tests/python/test_manifest_covers_demos.py` closes the class of hole
rather than the instances: every demo directory is in the manifest, every
manifest route has a directory, every routed demo is in `features:`,
`features:`/`not_supported_features` do not overlap, every `runtimeUrl` resolves
to a real API directory, and every literal `agent` id is registered by the
runtime it posts to. Each check was confirmed to fail against the pre-fix tree,
not merely to pass after it.

**Still not at langgraph-python parity** (4 cells, all deliberate): `a2ui-recovery`
is not ported; `shared-state-streaming` stays `not_supported`; `hitl` and
`hitl-in-chat-booking` are ag2-only extras.

**Same bug elsewhere:** `crewai-crews` has the identical `declarative-*` page →
`byoc-*` directory 404 on both cells. Not fixed here (different integration).

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
  (`src/agents/a2ui_dynamic.py`) is an ag2 `A2UIServer` + `AgUiTransport`
  (see "Dynamic A2UI on ag2's own stack" below). Runtime route at
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
  **Reasoning channel DOES light up on ag2 1.0** — the pre-1.0
  framework-bridge limitation described below was fixed upstream and
  re-verified against aimock; see the "ag2 1.0 migration" note above.

### Batch 2 — Dedicated AG2 sub-apps

These demos own their own `Agent`(s) plus FastAPI sub-app
mounted at a named path (`agent_server.py` mounts each one before the
catch-all `/`). The Next.js runtime points an `HttpAgent` at the
matching path so each demo gets its own conversation-variables state
slot, isolated from the shared default agent.

- `shared-state-read-write` — bidirectional shared state via ag2
  `Context.variables`. Agent calls `get_current_preferences`
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
- ~~`byoc-hashbrown`, `byoc-json-render`~~ — **no longer deferred; shipped as
  `declarative-hashbrown` / `declarative-json-render`.** They had in fact been
  built in full (agent, catalog, renderer, components, fixture) and were only
  unregistered plus 404ing on a directory-name mismatch — see "Six
  built-but-unreachable cells shipped" above. Registry note: the feature ids
  `byoc-hashbrown` / `byoc-json-render` still exist in
  `shared/feature-registry.json` alongside the `declarative-*` ids; langgraph-python
  ships the `declarative-*` pair, so ag2 follows that and the `byoc-*` ids stay
  unshipped for everyone.
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

> **Superseded by the ag2 1.0 migration — re-verified, not just assumed.**
> ag2 1.0 reads `delta.reasoning_content` into `ModelReasoning`
> (`ag2/config/openai/openai_client.py`) and `AGUIStream`
> (`ag2/ag_ui/stream.py`) maps it to `REASONING_MESSAGE_*` natively. The
> analysis below — verified against `ag2==0.13.3` — no longer describes the
> current bridge; the reasoning cells were re-verified on 1.0.1 and the
> custom SSE workaround it motivated has been deleted. Kept for history.

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
