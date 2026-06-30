# Built-in Agent — Parity Notes

This file documents the deliberate adaptations, divergences, and outstanding
gaps between the `built-in-agent` (BIA) showcase integration and the
LangGraph-Python (LGP) reference integration. Auditors, harness authors, and
D6 probes should consult this before flagging "missing" parity items.

## Agent-id convention

Every demo in this integration targets the agent literal `default`. Per-demo
specialization (system prompt, tool surface, factory hooks) happens at the
API-route + factory layer; see `src/lib/factory/` for the per-route factory
wiring.

Harness selectors, e2e specs, and D6 probes that key off agent-id MUST accept
`default` for this integration. Do not assume the agent-id matches the demo
slug — that is the LGP convention, not BIA's.

## Strategy-B adaptations (NOT NSFs)

The following demos render the same UX as the LGP equivalents but use a
different primitive under the hood. They are deliberate adaptations because
BIA has no `interrupt()` primitive:

- `gen-ui-interrupt` — uses `useFrontendTool` with an async handler instead
  of `useInterrupt` + `CUSTOM_EVENT`. The Promise returned by the async
  handler resolves when the user picks a slot (or cancels).
- `interrupt-headless` — same Strategy-B handler model, no chat UI.

These are full-capability demos and SHOULD NOT be added to
`not_supported_features`. They are currently quarantined for a separate
upstream reason (see Reasoning-trio below).

## `shared-state-read-write` — UI divergence

BIA's `shared-state-read-write` demo uses a **notes-card** UI; LGP uses a
**recipe-card** UI. This is a UX choice, not a capability gap. The
underlying `useCoAgent` read/write contract is identical.

Drop notes-card vs. recipe-card divergence from any "missing testids"
expectation set when comparing BIA to LGP — harnesses should match on
capability, not on the specific component rendered.

## `tool-rendering` companion components — deferred

The per-tool renderers (`weather-card`, `flight-card`, `stock-card`,
`d20-card`, custom-catchall) used by `tool-rendering` in LGP have not yet
been ported to BIA. This is tracked as a follow-up PR — the demo wiring is
present but currently renders against the default catch-all only.

## `tool-rendering-default-catchall` — built-in kit responsibility

The `shadcn-catchall-*` testid expectation lives in
`@copilotkit/react-ui` (the built-in default renderer ships from the kit,
not from the integration). PM escalation is pending to confirm whether the
testid should ship from the kit; until then, BIA cannot satisfy the
expectation by patching its own source.

## Reasoning-trio — manifest-quarantined

The following three demos are listed in `manifest.yaml` under
`not_supported_features` pending a `@copilotkit/react-core` package release
that fixes a `useInterrupt`/`useHeadlessInterrupt` RESUME-PATH bug (the
backend resumes fine but the frontend never appends the confirmation
bubble):

- `reasoning-default-render`
- `agentic-chat-reasoning`
- `tool-rendering-reasoning-chain`

Backend reasoning-event emission is also TBD on the built-in agent factory.
Once the upstream `react-core` fix lands AND the factory emits
`REASONING_MESSAGE_*` events, the quarantine should be lifted in the same
PR that bumps `@copilotkit/react-core`.

## NSF banners

Two demos render a graceful "not supported" banner with
`data-testid="not-supported-banner"` so the harness can detect them
deterministically instead of timing out on missing UI (mount wired by
PR #5413, commit `3585c33b8`):

- `gen-ui-interrupt` (NSF-quarantined: BIA has no `interrupt()` primitive;
  see Strategy-B adaptations above for the async-handler model used by the
  non-quarantined HITL demos)
- `shared-state-streaming` (BIA has no per-token state-delta streaming)

The dashboard-labeled "In-chat" and "In-app" HITL demos (`hitl-in-chat`,
`hitl-in-app`) are GREEN on staging — they are NOT NSF. They use
`useFrontendTool` with async handlers per the Strategy-B adaptation
documented above.

D6 probes should treat a `not-supported-banner` hit as PASS-SKIPPED, not
FAIL.

## `multimodal` — `copilot-add-menu-button`

The `copilot-add-menu-button` testid is rendered by
`@copilotkit/react-core/v2`'s `CopilotChatInput` (see
`packages/react-core/src/v2/components/chat/CopilotChatInput.tsx`). It is
present in the published kit; no BIA-side cell change is required. The
multimodal demo styles the menu button via a wrapper CSS selector — see
LGP's `multimodal-chat.tsx` for the pattern.

## When to update this file

- Adding a Strategy-B adaptation → document the primitive substitution here.
- Adding a per-demo UI divergence vs. LGP → document the rationale.
- Lifting a manifest quarantine → remove the corresponding entry above and
  flip `not_supported_features` in `manifest.yaml` in the same commit.
- Adding an NSF banner → list the demo + testid here.

## Known Issues — Downstream Renderer / State-Subscription Gaps (Follow-up PR)

PR #5425 added the necessary integration-layer plumbing for these demos
(source-level testids, aimock fixtures, factory backend wiring), but D6
runs revealed that the remaining failures live DOWNSTREAM of the
integration layer — in the A2UI renderer host and the AG-UI →
`useAgent`/`useCoAgent` state-subscription path. Those fixes belong to
upstream packages (`@copilotkit/react-core`, A2UI renderer host) and are
tracked as a follow-up PR. This PR's diff is correct at the integration
layer.

### `a2ui-fixed-schema` — RED (testid never mounts)

- D6 status: RED — `a2ui-fixed-card` testid never appears in DOM.
- This PR addressed: testid in source (✓), aimock fixture created and
  consumed by the run (59 KB payload, ✓), factory backend emits a
  well-formed v0.9 A2UI op envelope and `display_flight` tool fires (✓).
- What's missing: the A2UI renderer host does not project the Card into
  the DOM despite receiving a valid envelope. No integration-layer change
  can satisfy the testid expectation until the host renders.
- Suspected fix location: A2UI renderer host package (the consumer of the
  v0.9 op envelope), not the BIA integration.
- Action: tracked in follow-up PR against the renderer-host package.

### `declarative-gen-ui` — RED (testids never mount)

- D6 status: RED — `declarative-card` and `declarative-metric` testids
  never appear in DOM.
- This PR addressed: testids in source (✓), aimock fixture created and
  consumed by the run (65 KB payload, three-stage sequence works, ✓),
  factory wiring fires `generate_a2ui` correctly (✓).
- What's missing: same renderer-host class of failure as
  `a2ui-fixed-schema` — the host does not mount the projected components
  despite a valid generation stream.
- Suspected fix location: A2UI renderer host package.
- Action: tracked in follow-up PR; bundled with the
  `a2ui-fixed-schema` renderer-host fix.

### `gen-ui-agent` — GREEN (reclaimed; the react-core premise was stale)

- D6 status: GREEN — the cell passes the D6 probe end-to-end. The earlier
  claim (a `STATE_DELTA → useAgent` state-subscription gap in
  `@copilotkit/react-core`) was **stale and is now refuted** by local D6
  runs (3-turn probe, all assertions passed, `1 passed`, `green`).
- Why it works: the backend `set_steps` server-tool result is converted to
  a `STATE_DELTA` with `[{op:"add", path:"/steps", value:steps}]` in
  `src/lib/factory/tanstack-factory.ts` (the `set_steps` branch). `add`
  (not `replace`) is used deliberately so the patch lands even before
  `/steps` exists and `@ag-ui/client@0.0.57` never swallows it as
  `OPERATION_PATH_UNRESOLVABLE`. `@ag-ui/client`'s `AbstractAgent` applies
  the patch to `agent.state` and fires `onStateChanged`; the core
  state-manager's `handleStateDelta` saves it and fans `onStateChanged` to
  subscribers; `useAgent` re-renders the page off `agent.state.steps`. The
  wire-up is complete in the published kit — no react-core change is
  required.
- Evidence: the three-turn probe
  (`harness/src/probes/scripts/d5-gen-ui-agent.ts`) passes all assertions,
  including the `agent-state-card` + `≥2 [data-testid="agent-step"]` rows.
  The `set_steps → STATE_DELTA(add)` workaround already merged in
  `tanstack-factory.ts` closed the gap this note originally described.
- Action: none — fully supported and counted. The earlier "follow-up PR
  against `packages/react-core`" item is obsolete.

### headless-complete server-tool reprompt loop — resolved via sequenceIndex gating

BIA registers `get_weather` / `get_stock_price` / `get_revenue_chart` / `highlight_note` as **server-executed** tools via TanStack's `chat()` engine. After the LLM returns a tool call, TanStack runs the server tool and reprompts the LLM with the result; the original user pill text remains in conversation history, so userMessage-keyed toolcall fixtures would naively fire on every reprompt and the loop never converges. BIA's `/v1/responses` endpoint also rewrites assistant `tool_call_id`s to runtime-generated `fc-…` values, breaking the toolCallId-keyed narration fallback that works on non-rewriting backends.

Resolution (#5427 follow-up): `d6/built-in-agent/gen-ui-headless-complete.json` now structures each pill as a `(sequenceIndex:0 emitter, narration fallback)` pair. The emitter matches the FIRST request for the pill prompt (counter starts at 0) and emits the tool call; subsequent BIA reprompt iterations fall through the now-exhausted emitter to the narration fallback (no tool call), so the loop converges. `sequenceIndex` is chosen over `hasToolResult:false` because `hasToolResult` is computed across the entire thread — any earlier pill's tool result would permanently disable a `hasToolResult:false` emitter, breaking multi-turn sessions.

This pattern is BIA-specific because LGP runs these tools INSIDE the Python agent and emits them as AG-UI events directly — no TanStack reprompt cycle — so LGP's `gen-ui-headless-complete.json` retains the simpler userMessage-only emitter pattern.

## Doc maintenance

PARITY_NOTES inaccuracies surfaced by staging verify after PR #5413 merge — fixed 2026-06-12.
