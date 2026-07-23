# Parity Notes — Hermes

Baseline: `showcase/integrations/langgraph-python/`.

Hermes is **born-in-showcase** (no `examples/integrations/` Dojo counterpart) and
is unusual among integrations: it is not a framework you author per-demo agents
in, it is a **complete agent** (Nous Research's Hermes) reached over the AG-UI
protocol. Every demo langgraph-python ships is ported and D5-green **except** the
ones listed under "Not supported" below. This document records where the
Hermes integration deliberately diverges from the canonical pattern and why.

## Backend model (structural divergence)

- **No `src/agents/`.** The backend is the Hermes agent itself, installed from
  the **fork** that carries AG-UI support (`hermes-agent[agui] @
git+https://github.com/mme/hermes-agent.git@<sha>` in `requirements.txt`,
  pinned to a commit SHA). The fork ships the Hermes core AND the
  `agui_adapter/` bridge, so the adapter is **NOT vendored** here — single
  source of truth. Run via `run_backend.py` → `python -m agui_adapter`.
  Canonical integrations put small per-demo agent code in `src/agents/`; Hermes
  has none — demo behavior comes from the single Hermes agent + fixtures
  (aimock) + server-side/client tools.
- **Why the fork, not PyPI (interim).** The AG-UI adapter is not yet merged
  into `NousResearch/hermes-agent` / published. Until it is, we pin the public
  fork by SHA (the fork branch is the upstream-PR vehicle). Clean end-state:
  when the adapter lands upstream and is published, switch `requirements.txt`
  to a plain `hermes-agent[agui]==<version>` PyPI pin and drop the git URL —
  no other change needed.
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
REASONING*MESSAGE*\* events; the non-reasoning demos share the same backend
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
state _streaming_ (langgraph's `StateStreamingMiddleware`) is **not** replicated;
the snapshot is emitted after the tool completes (end-state is identical). Same
`shared-state-streaming` limitation pydantic-ai documents.

## Shared harness / cross-integration edits

Two **shared** D5 probes gained a `completeOnMount` conjunct so an A2UI
surface that mounts progressively (its bubble text never stabilises for the
settle window → `reason=text-unstable`) completes on "surface mounted" instead
of "text settled". The two cases differ in blast radius, and that distinction
is load-bearing:

- **`d5-gen-ui-a2ui-fixed.ts` — unconditional (all integrations).** The
  a2ui-fixed-schema demo renders via A2UI in **every** integration, so its
  `a2ui-fixed-card` testid is universal (present in all 21 integration
  renderers, pre-existing on `main`). Applying `completeOnMount` to every slug
  is a strict superset — verified.
- **`d5-beautiful-chat-search-flights.ts` — scoped to hermes ONLY.**
  beautiful-chat's FlightCard is A2UI-rendered (`render_a2ui`) **only on
  hermes**; every other integration renders it **natively** and settles on
  text as it always has, and does **not** emit the `beautiful-chat-flight-card`
  testid. So `completeOnMount` here is gated on `ctx.integrationSlug ===
"hermes"` — applying it unconditionally would require a surface the 17 peers
  never mount and would red their previously-green turn. hermes's renderer is
  the only one carrying the `beautiful-chat-flight-card` testid; no peer
  renderer was modified (an earlier revision added it to langgraph-python and
  swapped the probe unconditionally — reverted, because langgraph renders
  beautiful-chat natively and stays green on text-settle).

Verified: hermes `a2ui-fixed-schema` + `beautiful-chat` D5-green; peer
renderers byte-identical to `main` (no cross-integration regression).

## multimodal — no PDF flatten

Images pass through to the vision model natively. langgraph's `_PdfFlattenMiddleware`
(pypdf → text) has no Hermes equivalent; a PDF's _contents_ are not read (the
prompt text is). The D5 image path is unaffected.

## Not supported (declared in `manifest.yaml`)

- `a2ui-recovery` — the EXHAUST hard-fail state needs an agent-emitted tool
  result carrying the `a2ui_recovery_exhausted` envelope (langgraph produces it
  in-graph via `ag_ui_langgraph.get_a2ui_tools`); a backend-less Hermes+aimock
  cannot. HEAL works. Same omission as pydantic-ai.
- `gen-ui-interrupt`, `interrupt-headless` — **quarantined upstream**;
  langgraph-python itself marks these not-supported (a `@copilotkit/react-core/v2`
  interrupt RESUME-PATH hook bug).

## Operational (CI wiring + planned follow-ups)

- **PR build-check: WIRED.** `showcase_build_check.yml` carries a `hermes` slot,
  so every PR touching `showcase/integrations/hermes/**` builds the image
  (`push: false`) — exercising the fork git-install (clone + source-build of
  `hermes-agent[agui]`) and catching Dockerfile / requirements / fork-SHA
  breakage pre-merge. No Railway needed.
- **On-demand aimock E2E: WIRED.** `test_e2e-showcase-on-demand.yml` accepts
  `hermes` (comment `/test-aimock hermes` or `workflow_dispatch`). A dedicated
  `hermes` agent*type (detected by `run_backend.py`) boots the adapter against
  aimock with the `HERMES_AGUI*\*`env from`entrypoint.sh`, then runs the
Playwright specs in `tests/e2e/`. Acceptance = a `workflow_dispatch` run
  (GH-Actions-only; not locally executable).
- **Deploy: intentionally NOT wired.** `deployed: false`; no
  `showcase_build.yml`/`showcase_deploy.yml` entry, no Railway service /
  `railway-envs.ts` SSOT entry, no pushed GHCR image. Blocked on the adapter
  landing upstream + a provisioned Railway service (do not fabricate a
  `railway_id`). Dashboard D5 in CI is deploy-coupled, so it follows deploy.
  Until then, D5 coverage is **local-only** (`bin/showcase test hermes:<demo>
--d5 --direct`).
- `npm run dev` starts Next **and** the single `:8000` Hermes backend
  (`concurrently`); it does not start aimock — use `bin/showcase up aimock hermes`
  for the full fixture-backed stack.
