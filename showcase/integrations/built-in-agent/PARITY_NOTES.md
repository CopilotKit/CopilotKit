# Built-in Agent — Parity Notes

This file documents the deliberate adaptations, divergences, and outstanding
gaps between the `built-in-agent` (BIA) showcase integration and the
LangGraph-Python (LGP) reference integration. Auditors, harness authors, and
D6 probes should consult this before flagging "missing" parity items.

## Frontends are byte-identical to LGP (Option A)

BIA has migrated to **Option A**: every `src/app/demos/*` frontend is a
**verbatim copy** of the corresponding LGP reference demo, and the backend is
a **named-agent registry** (see below). Whatever LGP renders, BIA renders —
there is no BIA-specific frontend fork to reconcile.

The one systematic difference is lint-mechanical, not semantic:

- **`consistent-type-imports` ESLint normalization.** BIA enforces the
  `@typescript-eslint/consistent-type-imports` rule (required for a green PR),
  so type-only imports are split into `import type { … }` groups. Roughly ~15
  of the demo frontends differ from their LGP source **only** by this import
  grouping. The split is semantically identical and DOM-identical (type
  imports are erased at build time); it changes zero runtime behavior. The
  remaining demo frontends are exact byte-for-byte copies.

Harnesses and D6 probes should therefore match BIA against LGP on
**capability and rendered DOM**, never on source-text equality — the
`import type` grouping is the expected and only allowed drift.

## Agent-id convention — named agents (SUPERSEDES the old `default` rule)

> The prior convention ("every demo targets the agent literal `default`") is
> **superseded and no longer true.** Do not rely on it.

Each demo now targets a **named agent equal to its frontend `agent="<id>"`
value**. The names are registered in `src/app/api/copilotkit/route.ts` (the
shared single-route registry) and in the dedicated `src/app/api/copilotkit-*`
routes for demos that need an isolated runtime (a2ui, byoc/declarative, mcp,
ogui, reasoning, auth, voice, multimodal, agent-config, beautiful-chat).

Examples of the agent-id ↔ frontend mapping (frontend literal → registered
agent):

- `agentic_chat`, `frontend_tools`, `human_in_the_loop` — legacy underscore
  ids retained where the byte-identical LGP frontend uses them.
- `hitl-in-chat`, `hitl-in-app`, `shared-state-read`,
  `shared-state-read-write`, `subagents`, `gen-ui-agent`,
  `threadid-frontend-tool-roundtrip`, `reasoning-custom`, `reasoning-default`,
  `tool-rendering-reasoning-chain`, … — hyphenated ids equal to the demo slug.
- Dedicated-route agents: `declarative-hashbrown-demo`,
  `byoc_json_render` (declarative-json-render), `a2ui-recovery`,
  `a2ui-fixed-schema`, `declarative-gen-ui`, `mcp-apps`, `multimodal-demo`,
  `auth-demo`, `agent-config-demo`, `voice-demo`, `beautiful-chat`,
  `open-gen-ui`, `open-gen-ui-advanced`.

Harness selectors, e2e specs, and D6 probes that key off agent-id MUST use the
demo's own named agent (its frontend `agent` value), NOT `default`. A generic
catch-all `default` agent is still registered for backward compatibility, but
no demo targets it.

## `shared-state-streaming` — no per-token state delta (backend divergence)

BIA has **no per-token state-delta streaming**. The demo is wired and
byte-identical to LGP's frontend, but the in-process TanStack backend does not
emit incremental `STATE_DELTA` tokens the way LGP's `shared_state_streaming.py`
does. It is honestly marked in `not_supported_features` and renders a
`data-testid="not-supported-banner"` (see NSF banners below).

## Interrupt demos — quarantined (upstream react-core RESUME-PATH bug)

`gen-ui-interrupt` and `interrupt-headless` are byte-identical to LGP and use
the same `useInterrupt` / `useHeadlessInterrupt` primitives. They are listed in
`not_supported_features` **for the same upstream reason LGP quarantines them**:
a `@copilotkit/react-core/v2` RESUME-PATH hook bug where the backend resumes
and streams fine (HTTP 200) but the frontend never appends the confirmation
assistant bubble, so the harness DOM settle-check times out.

The fix is a published-package change (out of scope for this integration), so
the demos are marked not-supported (skipped-incapable side-rows — not green,
not red — rather than counting as a regression). They remain wired. Lift the
quarantine in the same PR that bumps `@copilotkit/react-core`.

## Reasoning-trio — manifest-quarantined

The following are listed in `manifest.yaml` under `not_supported_features`
pending a `@copilotkit/react-core` release that fixes the same RESUME-PATH
class of bug, plus backend reasoning-event emission on the built-in factory:

- `reasoning-default-render`
- `agentic-chat-reasoning`
- `tool-rendering-reasoning-chain`

`tool-rendering-reasoning-chain` remains a wired **demo** (byte-identical to
LGP, backed by `src/lib/factory/reasoning-factory.ts`) but is excluded from
`features:` while quarantined — the same demo-present-but-not-a-feature shape
used for the interrupt demos. Once the upstream `react-core` fix lands AND the
factory reliably emits `REASONING_MESSAGE_*` events, lift the quarantine in the
`react-core`-bump PR.

## NSF banners

Two demos render a graceful "not supported" banner with
`data-testid="not-supported-banner"` so the harness detects them
deterministically instead of timing out on missing UI:

- `gen-ui-interrupt` (quarantined — see Interrupt demos above)
- `shared-state-streaming` (no per-token state-delta streaming)

D6 probes should treat a `not-supported-banner` hit as PASS-SKIPPED, not FAIL.

## `headless-complete` server-tool reprompt loop — sequenceIndex fixture gating

BIA registers `get_weather` / `get_stock_price` / `get_revenue_chart` /
`highlight_note` as **server-executed** tools via TanStack's `chat()` engine.
After the LLM returns a tool call, TanStack runs the server tool and reprompts
the LLM with the result; the original user pill text remains in conversation
history, so userMessage-keyed toolcall fixtures would naively re-fire on every
reprompt and the loop would never converge. BIA's `/v1/responses` endpoint also
rewrites assistant `tool_call_id`s to runtime-generated `fc-…` values, breaking
the toolCallId-keyed narration fallback that works on non-rewriting backends.

Resolution (#5427 follow-up): `d6/built-in-agent/gen-ui-headless-complete.json`
structures each pill as a `(sequenceIndex:0 emitter, narration fallback)` pair.
The emitter matches the FIRST request for the pill prompt (counter starts at 0)
and emits the tool call; subsequent BIA reprompt iterations fall through the
now-exhausted emitter to the narration fallback (no tool call), so the loop
converges. `sequenceIndex` is chosen over `hasToolResult:false` because
`hasToolResult` is computed across the entire thread — any earlier pill's tool
result would permanently disable a `hasToolResult:false` emitter, breaking
multi-turn sessions.

This pattern is BIA-specific because LGP runs these tools INSIDE the Python
agent and emits them as AG-UI events directly — no TanStack reprompt cycle — so
LGP's `gen-ui-headless-complete.json` retains the simpler userMessage-only
emitter pattern.

## `multimodal` — `copilot-add-menu-button`

The `copilot-add-menu-button` testid is rendered by
`@copilotkit/react-core/v2`'s `CopilotChatInput`. It ships in the published
kit; no BIA-side cell change is required. The multimodal demo styles the menu
button via a wrapper CSS selector — see LGP's `multimodal` demo for the
pattern (BIA's is byte-identical).

## `threadid-frontend-tool-roundtrip` — feature only (no catalog demo)

`threadid-frontend-tool-roundtrip` is listed under `features:` — the backend
registers a named `threadid-frontend-tool-roundtrip` agent in
`src/app/api/copilotkit/route.ts`, and the byte-identical frontend lives at
`src/app/demos/threadid-frontend-tool-roundtrip/`. It is intentionally **not**
a `demos:` entry: LGP's own manifest has no threadid demos entry either, and a
demos entry would fail `validate-constraints` because the shared
`showcase/shared/constraints.yaml` `constrained-explicit` allowlist does not
list it. To surface it as a catalog demo, that allowlist must gain the id
first (separate owner), after which a `demos:` entry can be added.

## Known Issues — Downstream Renderer / State-Subscription Gaps (Follow-up PR)

The remaining A2UI failures live DOWNSTREAM of the integration layer — in the
A2UI renderer host. Those fixes belong to upstream packages
(`@copilotkit/react-core`, the A2UI renderer host) and are tracked as a
follow-up PR. The integration-layer diff (source-level testids, aimock
fixtures, factory backend wiring) is correct.

### `a2ui-fixed-schema` — RED (testid never mounts)

- D6 status: RED — `a2ui-fixed-card` testid never appears in DOM.
- Integration layer is correct: testid in source (✓), aimock fixture created
  and consumed (✓), factory (`src/lib/factory/a2ui-fixed-schema-factory.ts`)
  emits a well-formed v0.9 A2UI op envelope and the `display_flight` tool fires
  (✓).
- What's missing: the A2UI renderer host does not project the Card into the DOM
  despite receiving a valid envelope. No integration-layer change can satisfy
  the testid expectation until the host renders.
- Suspected fix location: A2UI renderer host package. Tracked in a follow-up PR.

### `declarative-gen-ui` — RED (testids never mount)

- D6 status: RED — `declarative-card` and `declarative-metric` testids never
  appear in DOM.
- Integration layer is correct: testids in source (✓), aimock fixture created
  and consumed (three-stage sequence works, ✓), factory
  (`src/lib/factory/a2ui-factory.ts`) fires `generate_a2ui` correctly (✓).
- What's missing: same renderer-host class of failure as `a2ui-fixed-schema` —
  the host does not mount the projected components despite a valid generation
  stream.
- Suspected fix location: A2UI renderer host package; bundled with the
  `a2ui-fixed-schema` renderer-host fix.
- NOTE: `declarative-gen-ui` and `mcp-apps` are flagged as **PENDING D6
  CONFIRMATION** candidate NSF in `manifest.yaml` (a parallel agent is
  confirming whether they are downstream-RED rather than supported). They
  remain in `features:` until the orchestrator finalizes.

### `gen-ui-agent` — GREEN (reclaimed; the react-core premise was stale)

- D6 status: GREEN — passes the D6 probe end-to-end. The earlier claim of a
  `STATE_DELTA → useAgent` state-subscription gap in `@copilotkit/react-core`
  was stale and is refuted by local D6 runs.
- Why it works: the backend `set_steps` server-tool result is converted to a
  `STATE_DELTA` with `[{op:"add", path:"/steps", value:steps}]` in
  `src/lib/factory/tanstack-factory.ts` (the `set_steps` branch). `add` (not
  `replace`) is used deliberately so the patch lands even before `/steps`
  exists and `@ag-ui/client@0.0.57` never swallows it as
  `OPERATION_PATH_UNRESOLVABLE`. The wire-up is complete in the published kit —
  no react-core change is required.
- Action: none — fully supported and counted.

## Local D6 environment blocker — aimock `:latest` lacks context scoping

Four cells go RED **locally only** because the deployed
`ghcr.io/copilotkit/aimock:latest` image does not implement `context` /
`x-aimock-context` fixture scoping (its CLI has no `--context-field` flag and
`matchFixture` performs no context check). aimock loads every slug's fixtures
flat and matches by `userMessage` substring, first-match-wins in load order
(`d4/*` before `d6/*`; within `d6`, `ag2` before `built-in-agent`). So for a
pill whose `userMessage` is shared across slugs, an earlier-loaded fixture
(e.g. `d6/ag2/*` or `d4/*`) shadows built-in-agent's own fixture. Those
shadowing fixtures use `toolCallId`-gated narration, which never matches BIA's
`/v1/responses`-rewritten `fc-*` tool-call ids, so the reprompt loop never
converges. Affected cells (BIA fixtures are CORRECT and converge under a
context-aware aimock — verified inert under the stale image):

- `tool-rendering-custom-catchall` (rewritten to the BIA `sequenceIndex`
  emitter + narration-fallback pattern + the 4 LGP UI pills, context-rewritten)
- `headless-complete` (correct `sequenceIndex` fixture, shadowed)
- `gen-ui-agent` (correct competitor `set_steps` fixture shadowed by a generic
  `{userMessage:"summarize"}` `d4` entry — NOT the STATE_DELTA add-op; the
  factory `add /steps` is fine)
- `frontend-tools` (correct `sequenceIndex` emitter + closing narration,
  shadowed by `d6/ag2/frontend-tools.json`)

Fix (infra, not BIA): redeploy `showcase-aimock` from an aimock build that
includes `context` matching (present on aimock `origin/main`). CI/staging that
run a context-aware aimock will show these GREEN.

## declarative-gen-ui and mcp-apps — RESOLVED to GREEN (not NSF)

Both were earlier suspected downstream-host RED; per-demo probes against a
context-scoped aimock prove otherwise — both are GREEN:

- `declarative-gen-ui` — GREEN with **no change**. The earlier RED was purely
  cross-slug fixture shadowing (see the aimock section above); `a2ui-fixed-schema`
  passes on the same A2UI renderer host, so the host was never the problem. All
  four pills render their catalog testids and assertions pass.
- `mcp-apps` — GREEN after a fixture fix. Root cause: excalidraw's MCP
  `create_view` tool declares its `elements` param as a **string** (JSON-encoded
  array) in its `inputSchema`, but the fixtures emitted a raw JSON **array**. BIA
  declares the injected MCP tool locally via `jsonSchemaToZod` → `z.string()`, so
  the array arg failed input validation, the tool never executed against
  excalidraw, no `ACTIVITY_SNAPSHOT` fired, and the iframe never mounted. Fix:
  emit `elements` as a JSON string (in `tool-rendering-reasoning-chain.json`'s
  `create_view` entry, and the flowchart entry in `mcp-apps.json`). The external
  MCP server IS reachable from the demo container — not an external blocker.

## Real-LLM backend audit (fixes verified against REAL OpenAI, not aimock)

An audit that ran the demos against a **real** `OPENAI_API_KEY` (no aimock,
`OPENAI_BASE_URL` unset) surfaced backend bugs that the aimock fixtures masked.
Each item below was fixed and re-verified end-to-end in a browser against real
OpenAI (rendered testids + assistant text). These are orthogonal to the
aimock/D6 notes above.

### `cvdiag` `.js` import extensions — dev-only `/api/copilotkit` 500 (BLOCKER)

`src/cvdiag/*.ts` imported siblings with explicit `.js` extensions (e.g.
`from "./schema.js"`). Under `next dev --turbopack` + `moduleResolution:
bundler` those specifiers don't resolve, so `/api/copilotkit` returned 500 for
every request in dev. Prod `next build` tolerated it. Fixed by dropping the
`.js` extensions on the relative sibling imports in `schema.ts`,
`edge-headers.ts`, `emit.ts`, `pb-writer-fetch.ts`, `cvdiag-emitter.ts`.

### `shared-state-read` / `shared-state-read-write` — UI state never reached the backend

Root cause was a **client seeding race in the demo frontend**, not the
converter: the seed effect ran with `[]` deps, so it seeded the _provisional_
agent `useAgent` returns while the runtime `/info` sync is still in flight. When
the real runtime-synced agent swapped in (a new reference), the `[]`-deps effect
never re-ran, so the real agent — the one `runAgent` serialises into
`input.state` — shipped `state: {}` and the model answered "I don't see a
recipe." (The runtime's `convertInputToTanStackAI` already injects `input.state`
into the system prompt correctly.) Fixed by seeding on `[agent]` deps in both
demo pages, guarded by the existing `!recipe`/`!preferences` check so user edits
aren't clobbered. Verified: the model reads the seeded recipe/preferences.

### `shared-state-read-write` — `set_notes` result not turned into state

`set_notes` is a server tool (`server-tools.ts`) returning `{ notes }`, but
`tanstack-factory.ts`'s `convertStream` only translated
`AGUISendStateSnapshot` / `AGUISendStateDelta` / `set_steps` into STATE events.
Added a `set_notes` → `STATE_DELTA add /notes` branch (same RFC-6902 `add`-not-
`replace` rationale as `set_steps`). Verified: asking the agent to remember
something populates `notes-list` / `note-item`.

### `declarative-gen-ui` / `a2ui-recovery` — secondary A2UI LLM emitted empty output

`a2ui-factory.ts`'s `generate_a2ui` passed
`modelOptions.response_format: { type: "json_object" }`. TanStack's `openaiText`
targets the OpenAI _Responses_ API, which does NOT accept the Chat-Completions
`response_format` param — passing it made the secondary call return an **empty
string** (verified), so the surface never painted. Fixed by removing
`response_format` (JSON-only output is enforced by the system prompt, mirroring
the byoc factories) plus a defensive `stripJsonFences` unwrap. Verified against
real OpenAI: `declarative-gen-ui` and `a2ui-recovery`'s heal turn paint
`declarative-metric` / `declarative-pie-chart` / `declarative-bar-chart`.
(`a2ui-recovery`'s _exhaust_/failure-card path is driven by deterministic aimock
fixtures that force every validation pass to fail — a real LLM produces a valid
surface, so the failure card is not reproducible against a real key by design.)

### Reasoning trio — real reasoning trace via the Responses API

Real OpenAI chat-completions does NOT stream `reasoning_content` (only aimock
did), so the previous chat-completions `extractReasoning` adapter produced no
trace against a real key. `reasoning-factory.ts` now uses `openaiText` (the
Responses API, the same transport as every other demo) with
`modelOptions.reasoning = { effort: "high", summary: "auto" }` and a `type:
"custom"` converter that maps the Responses-API thinking STEP chunks
(`STEP_STARTED` `stepType:"thinking"` + `STEP_FINISHED` deltas) to
`REASONING_MESSAGE_*` AG-UI events. Verified against real OpenAI:
`reasoning-custom` renders the `reasoning-block`, `reasoning-default` renders the
built-in "Thought for …" block, and `tool-rendering-reasoning-chain` renders
BOTH the reasoning block and its tool cards (no tool-render regression).

Caveats (documented, not blockers):

- Reasoning summaries require `effort: "high"`; at `low`/`medium` real OpenAI
  frequently completes short prompts without emitting a summary part.
- OpenAI's prompt caching means an _identical_ prompt asked repeatedly may
  return a cached completion with no fresh reasoning summary — the first/fresh
  ask reliably produces one.
- This switches the reasoning demos' transport from chat-completions to the
  Responses API. Text + tool-call behaviour is unchanged (verified); the aimock
  D6 reasoning fixtures, if they were recorded for the chat-completions
  `reasoning_content` shape, would need re-recording for Responses-API reasoning
  summaries. The `manifest.yaml` `not_supported_features` entries were left
  untouched (not verifiable here without aimock).

### `auth` + `voice` `[[...slug]]` routes — dev-server-only 500, prod unaffected

`/api/copilotkit-auth/*` and `/api/copilotkit-voice/*` (the only two catch-all
`[[...slug]]` routes; every other route is a single `route.ts`) crash the dev
server's route worker at request time — under `next dev --turbopack` via a
PostCSS/worker panic, and under plain `next dev` (webpack) via a masked
"Jest worker encountered … child process exceptions" `WorkerError`. The crash is
below the handler (a try/catch inside the route never fires) and does NOT
reproduce in production: after `next build` + `next start`, `auth /info` returns
200 with a valid token and 401 without one, the auth chat runs end-to-end
(assistant replies, all `/info` + `/run` responses 200, zero console errors),
and `voice /info` returns 200. This is a `next dev` dev-server limitation with
catch-all API routes + the V2 runtime handler, not an integration bug — no
code change is warranted. Prod is unaffected.

## When to update this file

- Adding a per-demo capability divergence vs. LGP → document the rationale.
- Lifting a manifest quarantine → remove the corresponding entry above and flip
  `not_supported_features` in `manifest.yaml` in the same commit.
- Adding an NSF banner → list the demo + testid here.
