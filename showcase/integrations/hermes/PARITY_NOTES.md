# Parity Notes — Hermes

Baseline: `showcase/integrations/langgraph-python/`.

Hermes is **born-in-showcase** (no `examples/integrations/` Dojo counterpart) and
is unusual among integrations: it is not a framework you author per-demo agents
in, it is a **complete agent** (Nous Research's Hermes) reached over the AG-UI
protocol. Every demo langgraph-python ships is ported and D5-green **except** the
three listed under "Not supported" below. This document records where the
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

## Tool execution: client-side vs backend (behavioral divergence)

The `tool-rendering*` and `headless-complete` demos use tools (`get_weather`,
`search_flights`, `get_stock_price`, `roll_d20`, chart tools). langgraph-python
implements these as **backend** tools. Hermes currently implements them as
**client-executed `useFrontendTool` handlers returning deterministic fake data**
(the same proven path as `frontend-tools`/`gen-ui-tool-based`). The rendered
result is 1:1 with langgraph, but the **execution locus differs** (client vs
server).

**Planned follow-up:** ship a real Hermes "showcase demo" toolset (server-side
`get_weather` etc. via `HERMES_AGUI_TOOLSETS`) so these run backend-side, 1:1
with langgraph at the mechanism level.

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
- `tool-rendering-reasoning-chain` — aimock drops the `reasoning` payload on
  tool-call turns, so the interleaved reasoning-block never mounts under replay
  (tool cards + narration render fine). **pydantic-ai marks this same demo
  not-supported** for the same aimock limitation; closing it needs an upstream
  aimock change (emit reasoning alongside tool calls).

## Operational (planned follow-ups)

- **Not wired for deploy/CI.** `deployed: false`; no `showcase_deploy.yml` entry,
  Railway service, or GHCR image yet. Verified **local-D5-only**.
- `npm run dev` starts Next **and** the single `:8000` Hermes backend
  (`concurrently`); it does not start aimock — use `bin/showcase up aimock hermes`
  for the full fixture-backed stack.
