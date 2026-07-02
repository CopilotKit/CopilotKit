# Parity Notes — Hermes

Baseline: `showcase/integrations/langgraph-python/`.

Hermes is **born-in-showcase** (no `examples/integrations/` Dojo counterpart) and
is unusual among integrations: it is not a framework you author per-demo agents
in, it is a **complete agent** (Nous Research's Hermes) reached over the AG-UI
protocol. Every demo langgraph-python ships is ported and D5-green **except** the
ones listed under "Not supported" below. This document records where the
Hermes integration deliberately diverges from the canonical pattern and why.

## Backend model (structural divergence)

- **No `src/agents/`.** The backend is the published **`hermes-agent==0.17.0`**
  PyPI package plus a **vendored `agui_adapter/`** bridge (the Hermes AG-UI
  adapter), run as `python -m agui_adapter`. Canonical integrations put small
  per-demo agent code in `src/agents/`; Hermes has none — demo behavior comes
  from the single Hermes agent + fixtures (aimock) + client-registered tools.
- **Vendored adapter (planned follow-up).** `agui_adapter/` is vendored because
  the adapter is not yet part of a published `hermes-agent` release. The clean
  end-state is to publish the adapter in a Hermes release and `pip install` it,
  dropping the vendored copy. Tracked as a follow-up.
- **Generic AG-UI `HttpAgent`** wiring (like `pydantic-ai` / `crewai-crews` /
  `agno`), with dedicated `api/copilotkit-<feature>/route.ts` per feature family.

## Tool execution: server-side (1:1 with langgraph)

The `tool-rendering`, `tool-rendering-default-catchall`,
`tool-rendering-custom-catchall`, and `headless-complete` demos use tools
(`get_weather`, `search_flights`, `get_stock_price`, `roll_d20`,
`get_revenue_chart`). langgraph-python implements these as **backend** tools, and
Hermes now does too — they run **SERVER-SIDE** in the Hermes agent loop, 1:1 with
langgraph at the mechanism level.

**Mechanism (vendored in this integration; no Hermes-core edits):**

- `integrations/hermes/showcase_tools.py` defines the real, deterministic tool
  handlers and registers them into Hermes' `tools.registry` on import, under a
  `hermes-showcase` toolset (`check_fn=lambda: True`). Return shapes are the exact
  deterministic shapes the demo cards + D5 assertions expect.
- `integrations/hermes/run_backend.py` is the launcher: it `import`s
  `showcase_tools` (registering the tools) then starts the AG-UI adapter
  (`agui_adapter.entry.main`). `entrypoint.sh` (and the `dev` script) run
  `python run_backend.py`, and set `HERMES_AGUI_TOOLSETS=hermes-acp,hermes-showcase`
  so the per-run agent enables the demo tools via its normal toolset path
  (`resolve_toolset` merges registry-provided toolsets; see hermes-agent
  `toolsets.py` / `model_tools._compute_tool_definitions`).
- The frontend registers these as **render-only** tools: `useRenderTool` (per-tool
  renderers in `tool-rendering` / `headless-complete`) or plain
  `useDefaultRenderTool` (the two catch-all demos). No client `handler` — the agent
  calls the tool, Hermes runs the real handler in-loop, and the result reaches the
  renderer via AG-UI's `TOOL_CALL_RESULT`. The D5 aimock fixtures only make the
  model EMIT the tool call and narrate; the tool RESULT comes from the server
  handler, not the fixture.

**Still legitimately client-executed** (unchanged): `frontend-tools`,
`frontend-tools-async`, `hitl-*`, and `gen-ui-tool-based` use `useFrontendTool` /
frontend components because those tools genuinely execute in the browser.
`headless-complete`'s `highlight_note` also stays a client `useComponent` tool —
it is client UI, not data.

## Reasoning: single reasoning-capable backend

`reasoning-default` / `reasoning-custom` / `tool-rendering-reasoning-chain` route
to `api/copilotkit-reasoning/route.ts`, which now points at the **single Hermes
AG-UI backend on `:8000` running `gpt-5-mini`** — the same backend every other
demo uses. Reason: Hermes surfaces reasoning only from separate
`reasoning_content` provider deltas, which **aimock emits only for
reasoning-capable model families AND only when the fixture declares a `reasoning`
channel**. `gpt-5-mini` is a reasoning family, so the reasoning demos get
REASONING_MESSAGE_* events; the non-reasoning demos share the same backend
without spurious reasoning because their fixtures declare no `reasoning` channel.
The dedicated route survives only for its distinct endpoint + agent names.

`tool-rendering-reasoning-chain` composes this reasoning path with the
**server-side** showcase tools (`get_weather`/`search_flights`/`get_stock_price`/
`roll_dice` in the `hermes-showcase` toolset) across three chained pills. It is
**D5-green**. aimock emits `reasoning_content` deltas **on the same
tool-call turn** — verified directly against the running aimock
(`@copilotkit/aimock`, `ghcr.io/copilotkit/aimock:latest`): a fixture leg that
carries BOTH a `reasoning` field AND `content` routes through the
content-with-tool-calls response type (`isContentWithToolCallsResponse` →
`buildContentWithToolCallsChunks` in `dist/helpers.js`), which streams
`{delta:{reasoning_content}}` chunks BEFORE the `content` and `tool_calls`
deltas for any reasoning-capable model (`gpt-5` family; see
`isReasoningModel` in `dist/model-utils.js`). Curling
`/v1/chat/completions` with `model:"gpt-5-mini"`, `x-aimock-context: hermes`,
and the pill-1 prompt returns `reasoning_content` deltas then `tool_calls` in
one streamed response. The one load-bearing requirement, already met by the
fixture, is that each tool-emitting leg carry non-empty `content` alongside its
`reasoning` — a `reasoning` + `toolCalls` leg with EMPTY `content` would route to
`isToolCallResponse` (`buildToolCallChunks`), which for a reasoning model still
emits `reasoning_content` — so the earlier "aimock drops reasoning on tool-call
turns" claim was **incorrect** and is retracted.

## Internal state-writer tools emit no chat chip

Shared-state demos (`gen-ui-agent`, `shared-state-read-write`) declare
state-writer tools (`set_steps`/`set_notes`) via `forwarded_props`. The adapter
**suppresses the visible `TOOL_CALL_*` chip** for these internal tools and emits
only the `StateSnapshotEvent` that drives the state card (the authoritative
surface) — matching langgraph's "state card is the sole surface" UX. Per-token
state *streaming* (langgraph's `StateStreamingMiddleware`) is **not** replicated;
the snapshot is emitted after the tool completes (end-state is identical). Same
`shared-state-streaming` limitation pydantic-ai documents.

## Shared harness / cross-integration edits

To settle A2UI surfaces that render **without a trailing text bubble**, two
**shared** D5 probes gained an additive `completeOnMount` conjunct
(`d5-gen-ui-a2ui-fixed.ts`, `d5-beautiful-chat-search-flights.ts`), and
langgraph-python's FlightCard renderer gained a `data-testid="beautiful-chat-flight-card"`
(strict superset — langgraph still mounts it). Both langgraph guards
(`a2ui-fixed-schema`, `beautiful-chat`) verified green after the change.

## multimodal — no PDF flatten

Images pass through to the vision model natively. langgraph's `_PdfFlattenMiddleware`
(pypdf → text) has no Hermes equivalent; a PDF's *contents* are not read (the
prompt text is). The D5 image path is unaffected.

## Not supported (declared in `manifest.yaml`)

- `a2ui-recovery` — the EXHAUST hard-fail state needs an agent-emitted tool
  result carrying the `a2ui_recovery_exhausted` envelope (langgraph produces it
  in-graph via `ag_ui_langgraph.get_a2ui_tools`); a backend-less Hermes+aimock
  cannot. HEAL works. Same omission as pydantic-ai.
- `gen-ui-interrupt`, `interrupt-headless` — **quarantined upstream**;
  langgraph-python itself marks these not-supported (a `@copilotkit/react-core/v2`
  interrupt RESUME-PATH hook bug).

## Operational (planned follow-ups)

- **Not wired for deploy/CI.** `deployed: false`; no `showcase_deploy.yml` entry,
  Railway service, or GHCR image yet. Verified **local-D5-only**.
- `npm run dev` starts Next **and** the single `:8000` Hermes backend
  (`concurrently`); it does not start aimock — use `bin/showcase up aimock hermes`
  for the full fixture-backed stack.
