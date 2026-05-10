# LangGraph-Python test genuine-pass

**Date:** 2026-05-07
**Owner:** alem@copilotkit.ai
**Repo:** CopilotKit
**Branch:** worktree-binary-orbiting-owl (off main `d446b29fe`)

## Goal

Every cell in `showcase/integrations/langgraph-python/manifest.yaml` must have:

1. A **per-cell Playwright spec** (Layer 1) whose assertions are genuine: only pass when the feature's wiring works, fail when the wiring is broken — independent of what the LLM (or aimock fixture) says.
2. A **D5 probe** (Layer 2) that points at the right route, drives a deterministic UI pill, and asserts a feature-mechanism side effect on Railway against the real LLM.

"Genuine" means an assertion that fails iff the feature's mechanism is broken. Three valid assertion shapes:

- **DOM consequence of feature wiring** — a React render path or framework hook that only fires if the feature is wired (e.g. `useRenderTool` mounts `<WeatherCard />`; `useFrontendTool` handler mutates the DOM; `useInterrupt` mounts the choice card).
- **DOM consequence of UI state** — a state/style propagation only the feature can produce (e.g. computed `background-color` from theme tokens; popup-scoped message tree; slot wrapper override).
- **Network-payload assertion** — `page.route()` interception of the outgoing agent request, asserting the framework included the right field (e.g. attachments in the message, agent-context in the body, multi-turn history, decision payload).

A test that asserts on **the response text the LLM produced** is tautological under aimock (it just proves aimock replayed its fixture) and flaky under real LLM. Those assertions are not genuine and must be dropped or converted to one of the three shapes above.

## Non-goals

- Reconciling `shared-state-read.spec.ts` + `shared-state-write.spec.ts` against the `shared-state-read-write` manifest cell. Skip this — leave the two specs as-is.
- Refactoring the showcase harness, the aimock package, or the manifest schema. Surgical changes only.
- Other integrations (`adk`, `agno`, `mastra`, etc.). LangGraph-Python only.
- New cells. Coverage of existing cells only.

## Background (load-bearing facts)

- Manifest cells: 35 (excluding `cli-start`).
- Layer 1 specs at `showcase/integrations/langgraph-python/tests/e2e/*.spec.ts` — 39 files.
- Layer 2 D5 probes at `showcase/harness/src/probes/scripts/d5-*.ts` — 31 files.
- Aimock fixtures at `showcase/aimock/d5-all.json` (704 lines), `showcase/aimock/feature-parity.json`, `showcase/aimock/smoke.json`.
- D5 mapping at `showcase/harness/src/probes/helpers/d5-feature-mapping.ts`.
- Per-cell suggestion pills already use `useConfigureSuggestions` in a sibling `suggestions.ts`. Some cells already expose in-page buttons with `data-testid` (e.g. voice sample-audio button, multimodal sample-image button) — that pattern extends.

## Layer 1 audit (input data)

| Verdict           | Count | Cells                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🟢 genuine        | 22    | a2ui-fixed-schema, agent-config, auth, beautiful-chat, chat-customization-css, chat-slots, declarative-gen-ui, frontend-tools, frontend-tools-async, gen-ui-agent, gen-ui-tool-based, headless-complete, headless-simple, hitl-in-chat, prebuilt-popup, prebuilt-sidebar, reasoning-custom, renderer-selector, shared-state-streaming, tool-rendering-custom-catchall, tool-rendering-default-catchall, voice |
| 🟡 partial        | 12    | agentic-chat, byoc-hashbrown, byoc-json-render, gen-ui-interrupt, mcp-apps, multimodal, readonly-state-agent-context, shared-state-read, shared-state-write, subagents, tool-rendering, hitl-in-app                                                                                                                                                                                                           |
| 🔴 weak (skipped) | 2     | open-gen-ui, open-gen-ui-advanced                                                                                                                                                                                                                                                                                                                                                                             |
| 🪦 orphan         | 4     | hitl, interrupt-headless, reasoning-default-render, tool-rendering-reasoning-chain                                                                                                                                                                                                                                                                                                                            |

### Scope of this spec

Of the 12 🟡 + 2 🔴 cells above, only those whose tests have a **fundamentally tautological assertion** (assert on LLM-text content) or a **fundamentally unreachable assertion** (cross-origin contentFrame, console-spy) require a test rewrite. The rest already test the right behavior; the only gap is fixture coverage and `.skip()` removal — verification chores that don't change a single test assertion.

| Bucket                                          | Cells                                                                                                                                                                                                                                                    | Action                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Test rewrites required (this spec)              | `hitl-in-app`, `frontend-tools-async`, `readonly-state-agent-context`, `open-gen-ui`, `open-gen-ui-advanced`, `subagents`, `tool-rendering`, `tool-rendering-default-catchall`, `tool-rendering-custom-catchall`, `headless-simple`, `headless-complete` | Phase 1 below                                           |
| Fixture / unskip / cosmetic only (out of scope) | `agentic-chat`, `multimodal`, `byoc-hashbrown`, `byoc-json-render`, `gen-ui-interrupt`, `mcp-apps`                                                                                                                                                       | Tracked as a backlog at the bottom; not part of Phase 1 |
| Skipped per user decision                       | `shared-state-read`, `shared-state-write`                                                                                                                                                                                                                | Untouched                                               |

**Deployed showcase base URL** (for manual testing of the 4 cells in scope): `https://showcase-langgraph-python-production.up.railway.app/demos/<cell-id>`

## Layer 2 audit (input data)

- 16 cells have genuine D5 coverage.
- 13 cells have smoke-only D5 (keyword match against agent transcript).
- 4 cells have wrong-target probes (`mcp-apps`, `headless-complete`, `tool-rendering-default-catchall`/`-custom-catchall` share a probe, `open-gen-ui-advanced` shares `open-gen-ui`'s probe).
- 2 cells silently unmapped: `reasoning-default`, `reasoning-custom` (mapping references the OLD directory names).
- 4 dead probes: `d5-tool-rendering-reasoning-chain.ts`, `d5-interrupt-headless.ts`, `d5-hitl-steps.ts`, `d5-gen-ui-headless-complete.ts` (last one is unwired).

## Design

### Phase 0 — Cleanup & mapping fix

Single PR. Mechanical, no behavior change for any test that was actually working.

**Layer 1:**

- Delete `tests/e2e/hitl.spec.ts` — manifest has no `hitl` cell.
- Delete `tests/e2e/interrupt-headless.spec.ts` — cell deleted from manifest.
- Delete `tests/e2e/tool-rendering-reasoning-chain.spec.ts` — cell deleted from manifest.
- Rename `tests/e2e/reasoning-default-render.spec.ts` → `tests/e2e/reasoning-default.spec.ts`. Update internal `page.goto()` from `/demos/reasoning-default-render` → `/demos/reasoning-default`. Update test `describe()` title.

**Layer 2 — mapping in `d5-feature-mapping.ts`:**

- Replace key `agentic-chat-reasoning` with `reasoning-custom` (same value `["reasoning-display"]`).
- Replace key `reasoning-default-render` with `reasoning-default` (same value `["reasoning-display"]`).
- Remove key `tool-rendering-reasoning-chain` and its value `["tool-rendering-reasoning-chain"]`.
- Remove key `interrupt-headless` and its value `["interrupt-headless"]`.
- Remove key `hitl` (whose value is `["hitl-steps"]`).
- Remove key `hitl-in-chat-booking` only if it exists in the mapping (the audit did not flag it; verify by grep before editing).

**Layer 2 — probe scripts:**

- Delete `d5-tool-rendering-reasoning-chain.ts` + `.test.ts`.
- Delete `d5-interrupt-headless.ts` + `.test.ts`.
- Delete `d5-hitl-steps.ts` + `.test.ts`.
- `d5-gen-ui-headless-complete.ts` (273 lines): grep `d5-registry.ts` for the literal `"gen-ui-headless-complete"` and grep all of `showcase/` for any `registerD5Script({ featureTypes: [...] })` containing it. If neither matches, delete the file (and its `.test.ts`). If at least one matches, keep the file and add `"headless-complete": ["gen-ui-headless-complete"]` to the mapping; this also lets us defer the Phase-2A "headless-complete split" because the probe already exists, just unmapped.
- Probe `d5-reasoning-display.ts`: update its `preNavigateRoute` branch logic to use the new cell IDs (`reasoning-default` instead of `reasoning-default-render`, default to `reasoning-custom` instead of `agentic-chat-reasoning`).

**Verification for Phase 0:**

- `pnpm test` in `showcase/harness` passes.
- `pnpm playwright test --list` in `showcase/integrations/langgraph-python` shows no orphan specs.
- Grep confirms zero references to deleted symbols anywhere in `showcase/`.

### Phase 1 — Layer 1 specs: rewrite tautological assertions

Eleven cells. One PR per family. Each cell's End-state below describes specific test-logic changes only — fixture-key adds and pill rewrites are part of the work but listed only when a test rewrite depends on them.

**Recipe applied to every cell in this phase:**

1. Identify any assertion that checks LLM-produced text content (`toContainText(/<word>/)`, `getByText("<word>")` against assistant responses, etc.). Either delete it (if it's a tautology under aimock) or replace it with one of the three genuine shapes (DOM consequence of feature wiring, DOM consequence of UI state, or `page.route()` network-payload interception).
2. Identify any assertion that depends on a cross-origin / unobservable host (`iframe.contentFrame()`, `page.on("console", …)` spies on iframe scripts). Delete or replace with a host-side observable (iframe element presence, runtime-emitted event, post-message host bridge).
3. For tests whose `.skip()` reason is "Railway agent unreliable" or "LLM authoring slow": after the test logic is genuine per (1) + (2), an aimock fixture for the trigger prompt makes the test deterministic; un-skip.
4. Where pill clicks fire test-relevant prompts, the pill `message` field must equal the fixture key verbatim — this is fixture coverage, not a test rewrite, but is listed when the test sends pill messages today.

#### Family-1A: Interactivity

##### `hitl-in-app`

**Demo URL:** https://showcase-langgraph-python-production.up.railway.app/demos/hitl-in-app

**Currently** (`hitl-in-app.spec.ts`, 4 tests — 1 active, 3 skipped):

- Active: page loads with 3 ticket cards + composer + no open modal; pills render referencing each ticket.
- Skipped (`.skip()` reason: `request_user_approval` frontend tool not reliably invoked on Railway within 60s): approve flow, reject flow, empty-reason approve flow.
- Genuine setup already in place: ticket testids `[data-testid="ticket-12345|12346|12347"]`; modal testids `[data-testid="approval-dialog-overlay|-dialog|-reason|-approve|-reject"]`; portal-location assertion `body > [data-testid="approval-dialog-overlay"]`.

**End state** — explicit test list:

| #   | Test                      | Action                                      | Assertion                                                                                                                                                                                                          |
| --- | ------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | page loads                | navigate                                    | 3 tickets + composer + no modal (kept as-is)                                                                                                                                                                       |
| 2   | pills render              | navigate                                    | 3 pill testids visible (kept as-is)                                                                                                                                                                                |
| 3   | refund #12345 → approve   | click pill → wait for modal → click approve | next assistant message contains `"I am processing the $50 refund"` (leading phrase)                                                                                                                                |
| 4   | refund #12345 → reject    | click pill → wait for modal → click reject  | next assistant message contains `"refund request was not approved"` (leading phrase)                                                                                                                               |
| 5   | escalate #12347 → approve | click pill → wait for modal → click approve | next assistant message contains the deterministic "approved" leading phrase (exact wording TBD: read the agent's actual response on the demo URL once aimock fixture is wired, lock the leading phrase from there) |
| 6   | escalate #12347 → reject  | click pill → wait for modal → click reject  | next assistant message contains the deterministic "not approved / not escalated" leading phrase (same TBD pin)                                                                                                     |
| 7   | downgrade #12346          | —                                           | `test.skip()` with comment `// TODO: re-enable when downgrade flow is fixed (broken upstream as of 2026-05-07)`                                                                                                    |

**Why the text assertion is genuine here, not tautological:** the approve and reject branches produce _different_ deterministic agent responses (one says "processing", the other says "not approved"). Asserting which leading phrase appears proves the framework forwarded the correct decision payload (`{ approved: true }` vs `{ approved: false }`) — if the wiring were broken or always returned the same value, both tests couldn't pass. The text isn't tested because it's the LLM's content; it's tested because it's a deterministic function of which branch the framework took.

**Implementation notes:**

- Add aimock fixture entries for the 2 in-scope pill messages ("Approve refund for #12345" and "Escalate ticket #12347") that emit a `request_user_approval` tool call; the fixture must also have branched continuations so approve and reject produce the asserted leading phrases.
- All testids already exist — no production-code changes needed in this PR.
- Use `[data-role="assistant"]` selector for the next-message wait, then `toContainText("<leading phrase>")` for the assertion.
- Keep the `body > [data-testid="approval-dialog-overlay"]` portal-contract check in the active tests (probably as a step inside tests 3–6, asserting modal mounts at portal location before clicking approve/reject).

##### `frontend-tools-async`

**Demo URL:** https://showcase-langgraph-python-production.up.railway.app/demos/frontend-tools-async

**Currently** (`frontend-tools-async.spec.ts`, 🟢 in audit because aimock-backed and asserts on NotesCard testids). Cell exercises `useFrontendTool` with an async handler that simulates a 500ms notes-DB lookup. UI renders a Notes DB card with matching notes per the agent's `query_notes` tool call.

**Pills** (3 total): "Find project-planning notes", "Search for auth", "What do I have about reading".

**Production-state bugs (must fix before tests can pass):**

1. **"Find project-planning notes" pill matches a generic-plan fixture.** Clicking it returns `"Here is my plan: Research the topic, Outline key points, Draft the content, Review and refine, Finalize"` — that's a generic plan-of-action fixture leaking from another cell, NOT a Notes DB card with project-planning notes. Need a dedicated `query_notes` fixture for the verbatim pill prompt that emits a `query_notes(query="project planning")` tool call returning project-planning notes from the deterministic fixture.
2. **"Search for auth" pill matches the showcase-assistant catch-all.** Clicking it returns `"Hi there! I'm your showcase assistant. I can help with weather, charts, meetings, sales todos, flights, and theme toggling. What would you like to try?"` — same fixture-matcher pathology as `open-gen-ui`, `tool-rendering`, etc. Need a dedicated `query_notes(query="auth")` fixture that emits the tool call with auth-related notes.
3. **"What do I have about reading" works.** Renders Notes DB card titled `"Matching 'reading'"` with `1 match`, `Book recommendations` note, `Thinking Fast and Slow (Kahneman); The Design of Everyday Things (Norman).`, tagged `reading`. Followed by narration `"You have a note titled 'Book recommendations' that is tagged with 'reading.' It includes the following books: Thinking Fast and Slow by Daniel Kahneman, The Design of Everyday Things by Don Norman"`. Lock this fixture as the canonical shape; no production-code change needed.

**End state** — explicit test list:

| #   | Test                                                              | Action                                    | Assertion                                                                                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | page loads with 3 pills                                           | navigate                                  | composer + 3 pills visible (`Find project-planning notes` / `Search for auth` / `What do I have about reading`)                                                                                                                                                                                                                                                    |
| 2   | project-planning pill → Notes DB card with project-planning notes | click `Find project-planning notes` pill  | Notes DB card visible (header reads `Matching "project planning"` or equivalent), match count > 0, at least one note row with project-planning content (NOT the generic "Research the topic… Finalize" plan text)                                                                                                                                                  |
| 3   | auth pill → Notes DB card with auth notes                         | click `Search for auth` pill              | Notes DB card visible (header reads `Matching "auth"` or equivalent), match count > 0, at least one note row with auth-related content (NOT the showcase-assistant boilerplate)                                                                                                                                                                                    |
| 4   | reading pill → Notes DB card with Book recommendations            | click `What do I have about reading` pill | Notes DB card visible AND header reads `Matching "reading"` AND `1 match` AND a note titled `Book recommendations` AND content contains `Thinking Fast and Slow` and `The Design of Everyday Things` AND tag chip reads `reading`; assistant narration contains leading phrase `"You have a note titled \"Book recommendations\" that is tagged with \"reading\""` |

**Why these assertions are genuine:** the cell's feature is "async `useFrontendTool` handler runs and the agent uses its result". Each pill sends a different query string; the deterministic fixture must match that pill's verbatim prompt to produce the correct Notes DB card. If fixtures match wrong (bugs 1 and 2), the wrong card or no card renders — tests 2 and 3 catch that directly. Test 4 locks the working pill's full assertion shape so a regression can't silently demote it.

**Implementation notes:**

- **No new production-code testids needed** — the existing Notes DB card already has stable testids per the audit. Verify and reuse.
- **Aimock fixture work** — 3 verbatim pill-prompt fixtures, each emitting a `query_notes` tool call returning deterministic note rows that match the query (project-planning notes for pill 1, auth notes for pill 2, reading-tagged Book recommendations for pill 3). Apply the same matcher-priority fix used for `open-gen-ui` / tool-rendering — the showcase-assistant catch-all and any cross-cell plan-of-action fixture must NOT win over the specific pill prompts.
- **Spec rewrites** — replace any existing free-form keyword assertions with the 4-test pill-driven plan above.

#### Family-1B: Agent-state

##### `readonly-state-agent-context`

**Demo URL:** https://showcase-langgraph-python-production.up.railway.app/demos/readonly-state-agent-context

**Currently** (`readonly-state-agent-context.spec.ts`, 4 tests — 2 active, 2 skipped):

- Active: context-card renders with defaults + composer; editing name + timezone updates the published JSON preview (this IS genuine — if `useAgentContext` is broken, the JSON preview wouldn't reflect form changes since both are bound to the same state).
- Skipped (`.skip()` reason: Railway >60s round-trip): "Who am I?" pill → assistant reply; typed prompt referencing context → assistant reply.
- Existing testids: `[data-testid="context-card"]` (outer grid), `[data-testid="ctx-name"]` (name input), `[data-testid="ctx-timezone"]` (timezone select), `[data-testid="ctx-state-json"]` (JSON preview), `[data-testid="copilot-suggestion"]`, `[data-role="assistant"]`.
- Pills (suggestions): "Who am I?", "Suggest next steps", "Plan my morning".

**End state** — explicit test list:

| #   | Test                                                                 | Action                                                        | Assertion                                                                                                                              |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | page loads                                                           | navigate                                                      | context-card + composer render (kept as-is)                                                                                            |
| 2   | edits propagate to JSON                                              | type into name/timezone                                       | published JSON updates (kept as-is)                                                                                                    |
| 3   | "Who am I?" pill — identity card shows defaults + agent acknowledges | click "Who am I?" pill → wait for assistant response          | response contains leading phrase `"I see you're Atai"`; identity card has name=`Atai`, timezone=`America/Los_Angeles`, avatar text=`A` |
| 4   | activity checkboxes reflect default selection                        | (no driver — assert initial state on page load)               | `viewed the pricing page` checkbox is checked; `watched the product demo video` checkbox is checked                                    |
| 5   | "Suggest next steps" pill — agent gives next-steps reply             | click "Suggest next steps" pill → wait for assistant response | response contains leading phrase `"Since you recently viewed the pricing page and watched the product demo video"`                     |

**Why the response-text assertion is genuine here:** under real LLM on Railway, the only way the response can mention "Atai" / "America/Los_Angeles" / specific activities is if `useAgentContext` actually published the context fields into the outgoing request. Under aimock the deterministic response replays from the fixture — passing under aimock proves the round-trip wiring (pill click → tool call → assistant render path), and passing on Railway proves `useAgentContext` end-to-end. The two together cover the feature.

**Implementation notes:**

- **Production-code testid additions needed** (none of these exist today, per `demo-layout.tsx` lines 70–145):
  - `[data-testid="identity-name"]` on the name display `<div>` near line 136 (the one rendering `{userName || "Anonymous"}`).
  - `[data-testid="identity-timezone"]` on the timezone display `<div>` near line 139 (`{userTimezone}`).
  - `[data-testid="identity-avatar"]` on the avatar circle `<div>` near line 131–133 (rendering the first letter).
  - `[data-testid="activity-<slug>"]` on each activity `<label>` in the loop near lines 161–189, where `<slug>` is a stable kebab-case form of the activity name (e.g. `activity-viewed-pricing-page`, `activity-watched-product-demo-video`). Spec uses these for the test-4 checkbox assertion.
- Aimock fixture entries needed for `"Who am I?"` and `"Suggest next steps"` whose responses contain the exact leading phrases above.
- Un-skip the round-trip tests after the rewrite. Skip reason was Railway latency; aimock removes that.
- Keep test 2's edit-form-→-JSON assertion as-is.
- Pill `Plan my morning` is not in scope here — the existing 4-tests-→-5-tests structure leaves it unexercised; can be added later as a 6th test if desired.

#### Family-1C: Generative-UI iframe

##### `open-gen-ui`

**Demo URL:** https://showcase-langgraph-python-production.up.railway.app/demos/open-gen-ui

**Currently** (`open-gen-ui.spec.ts`, 3 tests, 2 skipped):

- Active: page loads with composer + 4 pills.
- Skipped (`.skip()` reason: LLM iframe-authoring slow on Railway): Quicksort pill → iframe; neural-network pill → SVG inside iframe (also unobservable via cross-origin `contentFrame()`).
- Pills (suggestions): "3D axis visualization (model airplane)", "How a neural network works", "Quicksort visualization", "Fourier: square wave from sines".

**Production-state bug (must fix before tests can pass):** 3 of the 4 pills don't actually render an iframe today — only `Fourier: square wave from sines` works. The other 3 pill prompts (3D axis, neural network, quicksort) eagerly match a default aimock fixture and the agent responds with the boilerplate greeting `"Hi there! I'm your showcase assistant. I can help with weather, charts, meetings, sales todos, flights, and theme toggling. What would you like to try?"` instead of emitting the open-gen-ui tool call. This is a fixture-coverage / fixture-priority bug — likely the showcase-assistant default fixture has a broad-match key that wins over the specific pill prompts. Until this is fixed, no iframe assertion can succeed for those 3 pills.

**End state** — explicit test list:

| #   | Test                         | Action                                         | Assertion                                                                                       |
| --- | ---------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | page loads                   | navigate                                       | composer + 4 pills visible (kept as-is)                                                         |
| 2   | Fourier pill → iframe        | click `Fourier: square wave from sines`        | `iframe[sandbox*="allow-scripts"]` is visible AND has a non-empty `srcdoc` (or `src`) attribute |
| 3   | 3D axis pill → iframe        | click `3D axis visualization (model airplane)` | same iframe-presence assertion as test 2                                                        |
| 4   | neural network pill → iframe | click `How a neural network works`             | same iframe-presence assertion as test 2                                                        |
| 5   | Quicksort pill → iframe      | click `Quicksort visualization`                | same iframe-presence assertion as test 2                                                        |

Per user decision, no `contentFrame()` introspection — iframe presence + non-empty source attribute is the assertion bar. "Rendering something" means the host successfully populated an iframe with content; whether the inner HTML is correct is out of scope.

**Fix sequence:**

1. **First**, repair the aimock fixture priority for the 3 broken pills. Add explicit, high-priority fixture entries for the verbatim pill prompts that emit a deterministic open-gen-ui tool call carrying inline HTML in the tool result. Make sure these win over any showcase-assistant-greeting catch-all fixture (either by being more specific keys, or by adjusting fixture priority/order in `d5-all.json` if the matcher honors order).
2. **Verify on the live demo URL** by clicking each of the 3 broken pills and confirming an iframe paints (not the default greeting).
3. **Then** drop the `contentFrame()` assertions in `open-gen-ui.spec.ts` and rewrite to the 5-test plan above. Un-skip all 4 pill tests.

**Implementation notes:**

- The Fourier pill already works — its fixture or path is correct; copy that shape for the other 3.
- No production-code testid additions needed; `iframe[sandbox*="allow-scripts"]` is a stable selector.
- Optional cosmetic: rewrite pill titles to drop the parentheticals (e.g. `"3D axis visualization (model airplane)"` → `"3D axis visualization"`) so they read as natural human prompts. Keep the verbatim message field aligned with the fixture key.

##### `open-gen-ui-advanced`

**Demo URL:** https://showcase-langgraph-python-production.up.railway.app/demos/open-gen-ui-advanced

**Currently** (`open-gen-ui-advanced.spec.ts`, 3 tests, 3 skipped):

- All 3 tests are skipped today (no active green coverage). Skipped tests use unobservable assertions: `iframe.contentFrame().getByRole("button")` (cross-origin blocked) and `page.on("console", …)` watching for iframe-script log output (brittle, depends on LLM authoring choices).
- Skip reason: LLM authoring time + cross-origin contentFrame access blocked.
- Pills (suggestions): "Calculator (calls evaluateExpression)", "Ping the host (calls notifyHost)", "Inline expression evaluator".

**Production-state bug (must fix before tests can pass):** 2 of the 3 pills don't render an iframe today — only `Inline expression evaluator` works. The other 2 pill prompts (Calculator, Ping the host) eagerly match a default aimock fixture and the agent responds with the boilerplate greeting `"Hi there! I'm your showcase assistant. I can help with weather, charts, meetings, sales todos, flights, and theme toggling. What would you like to try?"` instead of emitting the open-gen-ui tool call. Same root cause as the open-gen-ui cell — a too-broad showcase-assistant catch-all fixture is winning over the specific pill prompts. Until this is fixed, no iframe assertion can succeed for those 2 pills.

**End state** — explicit test list:

| #   | Test                                      | Action                                            | Assertion                                                                                       |
| --- | ----------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | page loads                                | navigate                                          | composer + 3 pills visible (kept as-is)                                                         |
| 2   | Inline expression evaluator pill → iframe | click `Inline expression evaluator`               | `iframe[sandbox*="allow-scripts"]` is visible AND has a non-empty `srcdoc` (or `src`) attribute |
| 3   | Calculator pill → iframe                  | click `Calculator` (or current verbatim title)    | same iframe-presence assertion as test 2                                                        |
| 4   | Ping the host pill → iframe               | click `Ping the host` (or current verbatim title) | same iframe-presence assertion as test 2                                                        |

Per user decision, no `contentFrame()` introspection, no console-spy roundtrip. Iframe presence + non-empty source attribute is the assertion bar. The sandbox-functions feature (host bridge round-trip) is intentionally not asserted in this spec — that would require either a same-origin sandbox or a host-side spy on the runtime's `sandbox-function-call` event, both deferred to a follow-up.

**Fix sequence:**

1. **First**, repair the aimock fixture priority for the 2 broken pills. Add explicit, high-priority fixture entries for the verbatim pill prompts (the long Calculator and Ping-the-host prompts) that emit a deterministic open-gen-ui tool call carrying inline HTML in the tool result. Apply the same matcher-priority fix as `open-gen-ui` — they share the same root cause.
2. **Verify on the live demo URL** by clicking each of the 2 broken pills and confirming an iframe paints (not the default greeting).
3. **Then** drop the `contentFrame()` and console-spy assertions in `open-gen-ui-advanced.spec.ts` and rewrite to the 4-test plan above. Un-skip all 3 pill tests.

**Implementation notes:**

- The Inline expression evaluator pill already works — copy its fixture shape for the other 2.
- No production-code testid additions needed.
- Optional cosmetic: rewrite pill titles to drop the `(calls foo)` parentheticals (e.g. `"Calculator (calls evaluateExpression)"` → `"Calculator"`). Keep the verbatim message field aligned with the fixture key.
- Coordinate the matcher-priority fix with `open-gen-ui` — likely a single-file change in `d5-all.json` covers both cells.

#### Family-1D: Multi-Agent

##### `subagents`

**Demo URL:** https://showcase-langgraph-python-production.up.railway.app/demos/subagents

**Currently** (`subagents.spec.ts`, 8 tests, 0 skipped):

- All tests pass against the existing demo, but only because they assert shallow signals (page renders, empty-state placeholders, indicators visible, `.bg-gray-50.rounded-lg` card class on flight/hotel results). None of them catch the 3 production bugs below.
- Pills (suggestions, currently UNRELATED to demo): "Write a blog post", "Explain a topic", "Summarize a topic".
- Subagent cards in the UI render: 🔎 Researcher, ✍️ Writer, 🧐 Critic — each with a `Task` field and a `Result` field.

**Production-state bugs (must fix before tests can pass):**

1. **Backend — `delegations` concurrent-update bug.** Clicking the `Summarize a topic` pill (and probably any flow that produces concurrent subagent updates in one step) returns HTTP 400 with `INVALID_CONCURRENT_GRAPH_UPDATE`: `"At key 'delegations': Can receive only one value per step. Use an Annotated key to handle multiple values."` The Python TypedDict for the agent state's `delegations` field needs `Annotated[list[Delegation], operator.add]` (or a comparable LangGraph reducer) so concurrent subagent emissions accumulate instead of conflicting.
2. **Subagent `Result` field shows showcase-assistant boilerplate.** When Writer and Critic finish, their card's `Result` field renders the showcase-assistant intro text (`"Hi there! I'm your showcase assistant…"` or `"Here are the things I can help with: …"`). The actual prose / critique output is not surfaced. Likely the subagent's response is being routed to a parent-tool catch-all OR the card reads from the wrong field. Trace the wiring of subagent → state → card-Result and fix at the point where boilerplate substitutes for content.
3. **Critic loops indefinitely.** After Writer finishes, Critic re-runs many times with identical input — visible in the chat as repeated `🧐 Critic finished reviewing the draft` cards stacking up, eventually hitting the 400 error from bug #1. Limit the supervisor → critic loop to a single iteration (configurable max-iterations on the critic subagent; default 1).

**End state** — explicit test list (after the 3 bugs are fixed):

| #   | Test                                                | Action                                                                               | Assertion                                                                                                                                                                                                                                                                                                                                                                    |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | page loads                                          | navigate                                                                             | sidebar chat input + 3 pills + 3 subagent indicator slots visible (kept; tightened to use testid selectors instead of CSS classes)                                                                                                                                                                                                                                           |
| 2   | "Write a blog post" → 3 subagent cards with content | click `Write a blog post` pill → wait for all 3 subagent cards to reach `done` state | `[data-testid="subagent-card-researcher"]`, `[data-testid="subagent-card-writer"]`, `[data-testid="subagent-card-critic"]` each visible AND each card's `[data-testid="subagent-result"]` is non-empty AND does NOT contain the showcase-assistant boilerplate string `"Hi there! I'm your showcase assistant"` AND does NOT contain `"Here are the things I can help with"` |
| 3   | "Explain a topic" → 3 subagent cards with content   | click `Explain a topic` pill → wait for all 3 cards `done`                           | same testid + non-boilerplate-content assertion as test 2                                                                                                                                                                                                                                                                                                                    |
| 4   | "Summarize a topic" → 3 subagent cards with content | click `Summarize a topic` pill → wait for all 3 cards `done`                         | same testid + non-boilerplate-content assertion as test 2; also asserts the `delegations` reducer fix is in place (test would fail with HTTP 400 if bug #1 returns)                                                                                                                                                                                                          |
| 5   | Critic runs once, not in a loop                     | click any pill → wait for terminal state                                             | `[data-testid="subagent-card-critic"]` count is exactly 1 (no stacking duplicates); the existing-card's status is `done` and stays `done` for at least 5 seconds (no re-entry)                                                                                                                                                                                               |

**Why these assertions are genuine:** the 3 subagent cards rendering with their actual content is the entire feature of the multi-agent demo. The boilerplate-rejection assertion catches bug #2 directly (any regression silently substitutes boilerplate). The card-count assertion catches bug #3. Successful completion of test #4 catches bug #1. None rely on LLM-content correctness — they rely on the right subagent's output reaching the right card, and the framework not crashing.

**Implementation notes:**

- **Production-code testid additions needed:**
  - `[data-testid="subagent-card-<role>"]` on each subagent card wrapper, where `<role>` ∈ `researcher | writer | critic`.
  - `[data-testid="subagent-result"]` on each card's Result content `<div>` (scoped under the card so the test reads card-specific content).
  - Optional: `[data-testid="subagent-status"]` on the status pill (`starting | working | done`) so test 5 can poll without parsing visual indicators.
- **Backend fixes:** annotate the `delegations` key on the Python agent state TypedDict; cap the critic-loop iteration count at 1.
- The current suggestion-pill messages (the long detailed prompts shown in the user output) stay as-is — they already produce the right behavior on Railway when bugs #1–#3 are fixed.
- This Layer 1 spec runs against aimock locally; aimock fixtures must produce the same 3-subagent flow deterministically (each pill → researcher facts → writer prose → critic critique, each card ending in `done` with non-boilerplate content).

#### Family-1E: Tool Rendering

##### `tool-rendering`

**Demo URL:** https://showcase-langgraph-python-production.up.railway.app/demos/tool-rendering

**Currently** (`tool-rendering.spec.ts`, 4 tests, 0 skipped):

- Existing tests type free-form prompts ("Hello", "What's the weather in London?", "Tell me the weather in Paris") and assert WeatherCard mounts via `[data-testid="weather-card"]` + `getByText("Humidity"|"Wind"|"Feels Like"|"Current Weather")`. None of the existing tests drive the 5 pills the demo actually exposes.
- Pills (suggestions): "Weather in SF", "Find flights", "Stock price", "Roll a d20", "Chain tools".

**Production-state bugs (must fix before tests can pass):**

1. **Weather in SF pill renders Tokyo weather.** No SF-specific aimock fixture exists; the prompt eagerly matches a Tokyo-weather fixture and the WeatherCard shows Tokyo data. Need a dedicated fixture for the verbatim "Weather in SF" pill prompt that returns deterministic San Francisco weather (e.g. specific temp, humidity, wind values) so the spec can assert SF-specific content.
2. **Find flights pill leaks the a2ui beautiful-chat fixture.** Clicking the pill shows `?→? 0 results No flights returned. Two flights shown above — United at $349 (08:00) and Delta at $289 (10:15), both on time.` That text is the a2ui fixture used by the beautiful-chat cell — it's matching across cells. Need a dedicated `search_flights` tool-call fixture for the verbatim "Find flights" pill prompt that emits a `search_flights` tool result with deterministic flight cards (specific airlines, prices, times) rendered in the tool-rendering card style, not the a2ui style.
3. **Roll a d20 pill rolls real randoms until it hits 20.** Currently the agent calls `roll_d20` repeatedly until it returns 20, which is non-deterministic in length. Mock as exactly 5 sequential tool calls: 4 returning specific non-20 values (e.g. 7, 14, 3, 19) and the 5th returning 20. Each tool call should render its own tool-card with the rolled value visible.
4. **Chain tools pill returns plain Tokyo text instead of chaining.** The pill prompt `"Chain a few tools in this single turn: get the weather in Tokyo, search flights from SFO to Tokyo, and roll a d20."` currently produces only `"Tokyo is 22°C and partly cloudy."` — no tool cards rendered. The agent isn't actually chaining tools; the fixture matches the Tokyo-text fixture and bails. Fixture needs to emit 3 tool calls in sequence (`get_weather` Tokyo, `search_flights` SFO→Tokyo, `roll_d20`) so all 3 tool cards render.

**End state** — explicit test list:

| #   | Test                                                      | Action                     | Assertion                                                                                                                                                                                                          |
| --- | --------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | page loads with 5 pills                                   | navigate                   | composer + 5 pills (Weather in SF / Find flights / Stock price / Roll a d20 / Chain tools) visible                                                                                                                 |
| 2   | Weather in SF → SF weather card                           | click `Weather in SF` pill | `[data-testid="weather-card"]` visible AND contains `San Francisco` text (or city testid `[data-testid="weather-city"]` reads `"San Francisco"`); deterministic temp / humidity / wind values from fixture surface |
| 3   | Find flights → flights card with 2+ deterministic flights | click `Find flights` pill  | `[data-testid="flights-card"]` visible AND ≥2 flight rows rendered with non-empty airline/price/time cells from the dedicated `search_flights` fixture (NOT the a2ui beautiful-chat boilerplate)                   |
| 4   | Stock price → AAPL tool card                              | click `Stock price` pill   | `[data-testid="stock-card"]` (or generic tool card scoped to `data-tool-name="get_stock_price"`) visible AND contains `AAPL` AND price `$338.37` AND change `-2.96%` from fixture                                  |
| 5   | Roll a d20 → 5 tool cards, last one is 20                 | click `Roll a d20` pill    | exactly 5 `[data-testid="d20-card"]` (or scoped tool-rendering cards with `data-tool-name="roll_d20"`) visible; the 5th card's result value is `20`; the first 4 are non-20                                        |
| 6   | Chain tools → 3 tool cards                                | click `Chain tools` pill   | `[data-testid="weather-card"]` + `[data-testid="flights-card"]` + `[data-testid="d20-card"]` (or equivalent tool-name-scoped cards) all visible after the single pill click                                        |

**Why these assertions are genuine:** each one depends on the agent's tool-call wiring and the per-tool render hook firing correctly. If `useRenderTool` is broken or the fixture matches wrongly, the specific testids and per-tool data won't render. The "5 cards, last one 20" assertion in test 5 directly catches any regression where the d20 mock isn't deterministic. Test 6 catches regressions where chain-tool mode falls back to plain text.

**Implementation notes:**

- **Production-code testid additions needed** (verify which exist; add missing):
  - `[data-testid="weather-card"]` already exists. Add `[data-testid="weather-city"]` to the city subfield if not present.
  - `[data-testid="flights-card"]` on the flights tool render (currently just renders something — confirm testid).
  - `[data-testid="stock-card"]` (or `data-tool-name="get_stock_price"`) on the stock tool render.
  - `[data-testid="d20-card"]` (or `data-tool-name="roll_d20"`) on each d20 tool render. Make sure it's emitted PER tool call so the test can count 5.
- **Aimock fixture work** — 5 verbatim pill-prompt fixtures, each emitting deterministic tool calls + results:
  - `Weather in SF` → `get_weather(city="San Francisco")` with locked values
  - `Find flights` → `search_flights(...)` with ≥2 flight rows (deterministic airlines/prices/times). MUST take precedence over the a2ui beautiful-chat fixture; check matcher priority.
  - `Stock price` → `get_stock_price(ticker="AAPL")` returning `{ ticker: "AAPL", price_usd: 338.37, change_pct: -2.96 }`. Already works on the demo — just needs the fixture pinned.
  - `Roll a d20` → 5 sequential `roll_d20()` tool calls returning `[7, 14, 3, 19, 20]` (or any 4 non-20s + final 20).
  - `Chain tools` → 3 sequential tool calls in one turn: `get_weather(city="Tokyo")`, `search_flights(from="SFO", to="Tokyo")`, `roll_d20()`. Final agent text optional; assertion is purely on the 3 cards.
- **Drop the existing 4 tests** (page loads / "Hello" / London / Paris) — replaced by the 6-test pill-driven plan above.
- The `tool-rendering` cell becomes the canonical assertion shape for tool-rendered cards in the suite — once these testids exist, `tool-rendering-default-catchall` (below) and `tool-rendering-custom-catchall` can also benefit from them.

##### `tool-rendering-default-catchall`

**Demo URL:** https://showcase-langgraph-python-production.up.railway.app/demos/tool-rendering-default-catchall

**Currently** (`tool-rendering-default-catchall.spec.ts`, 🟢 in audit because it asserts built-in DefaultToolCallRenderer testids — `data-tool-name="get_weather"`, status pill, etc. — but those assertions only exercise the default-renderer contract for whichever tool actually fires; if the fixture matcher misroutes the pill to a non-tool fixture, no tool card mounts and the test would fail in a non-genuine way (or pass shallowly if it only asserts on a `weather` tool which happens to fire from a leak)).

- Pills (suggestions): "Weather in SF", "Find flights", "Roll a d20", "Chain tools" — same set as `tool-rendering` minus stock price.
- Backend has tools defined; frontend registers ZERO custom render hooks — the OOTB default tool-call renderer must paint every tool card.

**Production-state bugs** — same fixture-matcher pathology as the `tool-rendering` cell above (Weather in SF → Tokyo, Find flights → a2ui leak, Roll a d20 → real randoms, Chain tools → plain text). The fixture-priority fix from `tool-rendering` is shared and covers this cell too.

**End state** — explicit test list:

| #   | Test                                                                  | Action                     | Assertion                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | page loads with 4 pills                                               | navigate                   | composer + 4 pills visible; verify ZERO custom render hooks registered (sanity: no `useRenderTool` / `useDefaultRenderTool` in `page.tsx`)                                                                                        |
| 2   | Weather in SF → default renderer paints `get_weather` card            | click `Weather in SF` pill | a default tool-render card with `data-tool-name="get_weather"` (or the project's canonical default-renderer testid) is visible AND its arguments display contains `San Francisco`                                                 |
| 3   | Find flights → default renderer paints `search_flights` card          | click `Find flights` pill  | a default tool-render card with `data-tool-name="search_flights"` is visible AND its result block shows ≥2 flight rows from the deterministic fixture (NOT a2ui leak)                                                             |
| 4   | Roll a d20 → default renderer paints exactly 5 `roll_d20` cards       | click `Roll a d20` pill    | exactly 5 default tool-render cards with `data-tool-name="roll_d20"` are visible; the 5th card's result is `20`; the first 4 are non-20                                                                                           |
| 5   | Chain tools → default renderer paints 3 cards                         | click `Chain tools` pill   | default tool-render cards for `get_weather`, `search_flights`, AND `roll_d20` all visible after the single pill click                                                                                                             |
| 6   | every tool card uses the BUILT-IN default renderer (not a custom one) | any of tests 2–5           | each rendered tool card matches the default-renderer DOM signature (e.g. has the OOTB `data-testid="copilot-tool-render"` wrapper or the equivalent built-in marker) — proves the cell isn't accidentally using a custom renderer |

**Why these assertions are genuine:** the cell's whole purpose is "out-of-the-box default renderer paints tool calls with zero custom code". Test 1 sanity-checks no custom registrations. Tests 2–5 prove the default renderer paints each tool kind. Test 6 catches regressions where a stray `useRenderTool` or `useDefaultRenderTool` sneaks into the page (would silently demote this cell to a custom-renderer cell).

**Implementation notes:**

- **Production-code testid additions needed:** confirm the OOTB default tool-call renderer emits a stable testid wrapper (likely `[data-testid="copilot-tool-render"]` or `data-tool-name="<name>"` on the card root). If not, add it in the framework's default renderer — but only if missing; the audit said "data-tool-name" already exists.
- **Aimock fixture work** — same 4 fixture additions as `tool-rendering` (Weather in SF, Find flights, Roll a d20 ×5, Chain tools), all sharing the same matcher-priority fix. Coordinate with `tool-rendering`: a single fixture update covers both cells since both pills hit the same backend agent.
- **Drop any existing tests** that don't drive these 4 pills; replace with the 6-test plan above.

##### `tool-rendering-custom-catchall`

**Demo URL:** https://showcase-langgraph-python-production.up.railway.app/demos/tool-rendering-custom-catchall

**Currently** (`tool-rendering-custom-catchall.spec.ts`, 🟢 in audit because it asserts the custom-catchall testid contract: tool-name, status, args, result fields rendered by a single branded wildcard renderer).

- Pills (suggestions): same 4 as the default-catchall cell — "Weather in SF", "Find flights", "Roll a d20", "Chain tools".
- Backend has tools defined; frontend registers ONE custom wildcard renderer via `useDefaultRenderTool` — the same branded card paints every tool call regardless of tool name.

**Production-state bugs** — identical fixture-matcher pathology to `tool-rendering` and `tool-rendering-default-catchall`. The fixture-priority fix from `tool-rendering` is shared and covers this cell too.

**End state** — explicit test list:

| #   | Test                                                             | Action                     | Assertion                                                                                                                                                                                                                                          |
| --- | ---------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | page loads with 4 pills                                          | navigate                   | composer + 4 pills visible; verify exactly ONE custom wildcard renderer registered in `page.tsx` (sanity: a single `useDefaultRenderTool` call, no per-tool `useRenderTool`)                                                                       |
| 2   | Weather in SF → custom wildcard card paints `get_weather`        | click `Weather in SF` pill | a card matching the custom-wildcard testid signature (`[data-testid="custom-wildcard-card"]` or the project's canonical custom-catchall testid) is visible AND its tool-name field reads `get_weather` AND its args field contains `San Francisco` |
| 3   | Find flights → SAME custom wildcard card paints `search_flights` | click `Find flights` pill  | a card with the SAME custom-wildcard testid signature as test 2 is visible AND its tool-name field reads `search_flights` AND its result field shows ≥2 flight rows from the deterministic fixture (NOT a2ui leak)                                 |
| 4   | Roll a d20 → 5 custom wildcard cards                             | click `Roll a d20` pill    | exactly 5 custom-wildcard cards visible, each with tool-name `roll_d20`; the 5th card's result is `20`; the first 4 are non-20                                                                                                                     |
| 5   | Chain tools → 3 custom wildcard cards (one per tool)             | click `Chain tools` pill   | 3 custom-wildcard cards visible after the single pill click, with tool-name fields `get_weather`, `search_flights`, AND `roll_d20` (one per card) — proves the wildcard renderer paints every tool kind, not just the first                        |
| 6   | every card across tests 2–5 shares the SAME testid signature     | (cross-test)               | snapshot the testid + DOM-shape of the card root from test 2 and confirm tests 3, 4, 5 cards match — proves the wildcard contract (one branded card paints every tool) is what's actually rendering, not multiple per-tool components              |

**Why these assertions are genuine:** the cell's whole purpose is "ONE branded card paints every tool call". Test 1 sanity-checks the registration count (exactly one `useDefaultRenderTool`). Tests 2–5 prove the wildcard fires for each tool kind. Test 6 is the load-bearing one for this cell — it explicitly asserts that the same testid signature appears across different tools, which is what differentiates this cell from `tool-rendering-default-catchall` (where the BUILT-IN default paints) and `tool-rendering` (where per-tool specialized renderers paint).

**Implementation notes:**

- **Production-code testid additions needed:** ensure the custom wildcard card has a stable testid (`[data-testid="custom-wildcard-card"]` or whatever the existing audit found — confirm by reading `page.tsx`). If the existing testid is generic (e.g. `tool-render`), tighten it so default-catchall and custom-catchall don't share the same testid (the cells should be distinguishable in DOM so test 6 of the default-catchall cell and test 6 of this cell don't collide).
- **Aimock fixture work** — same 4 fixtures as the other tool-rendering cells. The fixture-priority fix from `tool-rendering` is shared.
- **Drop any existing tests** that don't drive these 4 pills; replace with the 6-test plan above.
- This cell + `tool-rendering-default-catchall` + `tool-rendering` together form a 3-cell triangle that distinguishes the three rendering strategies (per-tool specialized / OOTB default / single custom wildcard). Each cell's tests must be specific enough that swapping the render strategy in one demo would break ONLY that cell's tests, not the others.

#### Family-1F: Headless

##### `headless-simple`

**Demo URL:** https://showcase-langgraph-python-production.up.railway.app/demos/headless-simple

**Currently** (`headless-simple.spec.ts`, 🟢 in audit because aimock-backed and asserts on custom composer DOM + suggestion chips). Cell exercises the minimum-viable headless chat: `useAgent` + `useCopilotKit` hooks dressed in shadcn primitives, no tool rendering, no generative UI — just text in / text out via a hand-rolled UI.

**Existing UI elements** (per the demo's `chat.tsx` / `composer.tsx` / `message-bubble.tsx` / `empty-state.tsx`):

- Custom composer (input + send button) rendered via shadcn primitives.
- Custom message bubbles rendering assistant + user messages.
- Suggestion pills shown in the empty state OR inline.

**Pills** (suggestions): "Say hello in one short sentence", "Tell me a one-line joke", "Give me a fun fact".

**End state** — explicit test list:

| #   | Test                                                                                         | Action                                                                                              | Assertion                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | page loads                                                                                   | navigate                                                                                            | custom composer + 3 pills visible (kept; tightened to use stable testids on the custom message-bubble container)                                                                                                                                    |
| 2   | "Say hello in one short sentence" pill → headless surface renders the deterministic greeting | click `Say hello in one short sentence` pill → wait for assistant bubble in the custom message area | `[data-testid="headless-message-assistant"]` (or the equivalent stable testid on the custom assistant bubble) contains text starting with `"Hello! I can help you with weather lookups, creating pie and bar charts"` (leading phrase from fixture) |
| 3   | "Tell me a one-line joke" pill → joke renders                                                | click `Tell me a one-line joke` pill → wait for assistant bubble                                    | custom assistant bubble contains text starting with `"Why did the scarecrow win an award? Because he was outstanding in his field!"`                                                                                                                |
| 4   | "Give me a fun fact" pill → fun fact renders                                                 | click `Give me a fun fact` pill → wait for assistant bubble                                         | custom assistant bubble contains text starting with `"A fun fact: Honey never spoils!"`                                                                                                                                                             |

**Why these assertions are genuine:** the cell's whole feature is "the headless `useAgent` hook delivers messages to a hand-rolled custom UI, not the default `<CopilotChat>` surface". Each pill produces a DIFFERENT deterministic response — passing all 3 tests proves (a) the right fixture matched (different leading phrases differentiate them), (b) the framework hooks (`useAgent` + `useCopilotKit`) wired the response into React state, AND (c) the custom message-bubble component rendered it (asserts on the headless-specific testid, not the default CopilotChat surface). If the headless hook regression silently routes back to the default surface, tests 2–4 fail because the custom-bubble testid isn't there. If the fixture-matcher misroutes a pill, the wrong leading phrase appears and the corresponding test fails.

**Implementation notes:**

- **Production-code testid additions needed** (verify which exist; add missing):
  - `[data-testid="headless-message-assistant"]` on the custom assistant bubble (in `message-bubble.tsx`).
  - `[data-testid="headless-message-user"]` on the custom user bubble (parallel, useful for completeness).
  - `[data-testid="headless-composer"]` on the custom composer container (for test 1's stable selector).
  - Pill testid `[data-testid="copilot-suggestion"]` likely already exists from the shared suggestions infrastructure — confirm.
- **Aimock fixture work** — 3 verbatim pill-prompt fixtures, each emitting the deterministic response above. Confirm these fixture entries exist in `d5-all.json` (the cell is currently 🟢 so they likely do); if any pill response drifts from the leading phrases listed, lock it.
- **Spec rewrites** — replace any existing free-form assertions with the 4-test pill-driven plan above. Keep test 1's page-load + pill-visibility check; replace any `[data-role="assistant"]` (default CopilotChat surface) selectors with the headless-specific testids.

##### `headless-complete`

**Demo URL:** https://showcase-langgraph-python-production.up.railway.app/demos/headless-complete

**Currently** (`headless-complete.spec.ts`, 🟢 in audit because aimock-backed and asserts on hand-rolled DOM elements). Cell exercises the FULL headless surface — hand-rolled `<CopilotChat>` replacement wiring every render hook (`useRenderTool`, `useDefaultRenderTool`, `useComponent`, `useRenderToolCall`, `useRenderActivityMessage`, `useSuggestions`, `useAttachments`) on top of shadcn primitives. Backend includes `get_weather`, `get_stock_price`, `highlight_note`, and `get_revenue_chart` tools.

**Pills** (4 total): "What's the weather in Tokyo?", "What's AAPL trading at?", "Highlight: ship the demo on Friday", "Show me a chart of revenue over the last six months".

**Production-state bug (must fix before tests can pass):**

- **Highlight pill matches the showcase-assistant catch-all.** Clicking `Highlight: ship the demo on Friday` returns `"Hi there! I'm your showcase assistant. I can help with weather, charts, meetings, sales todos, flights, and theme toggling. What would you like to try?"` — same fixture-matcher pathology as `open-gen-ui`, `open-gen-ui-advanced`, and the tool-rendering cells. Need a dedicated `highlight_note` fixture for the verbatim pill prompt that emits a `highlight_note` tool call carrying the highlight payload (`"ship the demo on Friday"`) so the headless `useRenderTool` for highlights can paint a Highlight component.
- The other 3 pills work today. Just need to lock the deterministic responses in fixtures.

**End state** — explicit test list:

| #   | Test                                                      | Action                                                       | Assertion                                                                                                                                                                                                                                                                                                                                                                        |
| --- | --------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | page loads                                                | navigate                                                     | custom composer + 4 pills visible (`What's the weather in Tokyo?` / `What's AAPL trading at?` / `Highlight: ship the demo on Friday` / `Show me a chart of revenue over the last six months`)                                                                                                                                                                                    |
| 2   | weather pill → headless WeatherCard + narration           | click weather pill → wait for tool card + assistant bubble   | `[data-testid="headless-weather-card"]` (or scoped tool-name testid) visible AND contains `Tokyo`, `Sunny`, `68°F`; `[data-testid="headless-message-assistant"]` contains leading phrase `"Tokyo is 22°C and partly cloudy."`                                                                                                                                                    |
| 3   | AAPL pill → headless StockCard + narration                | click AAPL pill → wait for tool card + assistant bubble      | `[data-testid="headless-stock-card"]` (or scoped tool-name testid) visible AND contains `AAPL`, `$189.42`, `+1.27%`; `[data-testid="headless-message-assistant"]` contains leading phrase `"AAPL is trading at $189.42, up 1.27% on the day"`                                                                                                                                    |
| 4   | Highlight pill → headless Highlight component + narration | click highlight pill → wait for tool card + assistant bubble | `[data-testid="headless-highlight-card"]` (or scoped tool-name testid for `highlight_note`) visible AND contains the highlighted text `"ship the demo on Friday"`; `[data-testid="headless-message-assistant"]` contains the deterministic narration leading phrase (TBD — read from demo once fixture is wired and lock the leading phrase)                                     |
| 5   | Revenue chart pill → headless ChartCard + narration       | click chart pill → wait for tool card + assistant bubble     | `[data-testid="headless-revenue-chart"]` (or scoped tool-name testid for `get_revenue_chart`) visible AND contains the chart title `"Quarterly revenue"`, the subtitle `"Last six months · USD thousands"`, AND month labels `Jan` through `Jun`; `[data-testid="headless-message-assistant"]` contains leading phrase `"Here is the chart of revenue over the last six months"` |

**Why these assertions are genuine:** the cell's whole feature is "every render hook works through a hand-rolled headless surface". Each test exercises a DIFFERENT hook: weather and stock through `useRenderTool` (per-tool specialized renderers), highlight through `useRenderTool` for `highlight_note`, chart through `useComponent` (or whichever hook the demo uses for the chart). If any single hook regresses, only that test fails. The narration assertion (assistant bubble text) proves the hand-rolled message-rendering wiring is intact alongside the tool-rendering. The 4 pills together exercise the major render-hook surface area; if a regression silently demotes the cell to the default `<CopilotChat>` surface, the headless-specific testids vanish and all 4 tests fail.

**Implementation notes:**

- **Production-code testid additions needed** (verify which exist; add missing):
  - `[data-testid="headless-weather-card"]` on the Weather component rendered by the headless useRenderTool registration.
  - `[data-testid="headless-stock-card"]` on the Stock component.
  - `[data-testid="headless-highlight-card"]` on the Highlight component (`tools/highlight-note.tsx` per the demo source).
  - `[data-testid="headless-revenue-chart"]` on the Chart component.
  - Reuse `[data-testid="headless-message-assistant"]` from `headless-simple` for the assistant bubble (same custom message-bubble component used by both cells, presumably).
  - If headless-simple and headless-complete share the same message-bubble component, the testid is added once and used by both specs.
- **Aimock fixture work:**
  - Lock fixture entries for the 3 working pills (weather Tokyo / AAPL / revenue chart) so the leading phrases above are deterministic and won't drift.
  - Add a new high-priority fixture entry for the broken `Highlight: ship the demo on Friday` pill that emits a `highlight_note` tool call with `{ note: "ship the demo on Friday" }` and a deterministic narration response. Apply the same matcher-priority fix used for `open-gen-ui` / tool-rendering — the showcase-assistant catch-all must NOT win over the specific pill.
- **Spec rewrites** — replace any existing free-form assertions with the 5-test pill-driven plan above.
- This cell + `headless-simple` together cover the headless surface: `headless-simple` proves the bare-minimum useAgent + custom UI works; `headless-complete` proves the full render-hook suite works on the same surface. Distinct test plans so a regression in one hook doesn't slip through both.

### Phase 2 — Layer 2 D5 probes to genuine

Lands after Phase 1 because it depends on Phase 1's testids and pills.

D5 runs on Railway against the real LLM. "Genuine" here means: probe drives the same UI pill the human (and Layer 1 spec) clicks, and asserts feature via the same `data-testid` Phase 1 introduced. Because the input is a deterministic pill click and the assertion is a side-effect testid, real-LLM variation does not flake the probe.

#### Phase-2A: Wrong-target splits

| Probe action                                                                                                                                                                              | Demo URL(s)                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Split `d5-mcp-subagents.ts` → `d5-mcp-apps.ts` (asserts iframe testid)                                                                                                                    | https://showcase-langgraph-python-production.up.railway.app/demos/mcp-apps                        |
| Split `d5-mcp-subagents.ts` → `d5-subagents.ts` (drives one of the 3 pills, asserts the same 3-subagent-card + non-boilerplate-content + single-critic test plan as Phase-1D `subagents`) | https://showcase-langgraph-python-production.up.railway.app/demos/subagents                       |
| Keep `d5-tool-rendering.ts` for `tool-rendering` cell                                                                                                                                     | https://showcase-langgraph-python-production.up.railway.app/demos/tool-rendering                  |
| Add `d5-tool-rendering-default-catchall.ts` (asserts built-in default renderer testid contract)                                                                                           | https://showcase-langgraph-python-production.up.railway.app/demos/tool-rendering-default-catchall |
| Add `d5-tool-rendering-custom-catchall.ts` (sends 2 tool calls, asserts both render with same custom wildcard testid)                                                                     | https://showcase-langgraph-python-production.up.railway.app/demos/tool-rendering-custom-catchall  |
| Keep `d5-gen-ui-headless.ts` for `headless-simple`                                                                                                                                        | https://showcase-langgraph-python-production.up.railway.app/demos/headless-simple                 |
| Add `d5-gen-ui-headless-complete.ts` (or revive existing file if Phase 0 keeps it) — drives a `get_revenue_chart` prompt, asserts ChartCard testid                                        | https://showcase-langgraph-python-production.up.railway.app/demos/headless-complete               |
| Keep `d5-gen-ui-open.ts` for `open-gen-ui`                                                                                                                                                | https://showcase-langgraph-python-production.up.railway.app/demos/open-gen-ui                     |
| Add `d5-gen-ui-open-advanced.ts` — asserts iframe presence + sandbox-functions testid                                                                                                     | https://showcase-langgraph-python-production.up.railway.app/demos/open-gen-ui-advanced            |

Update `d5-feature-mapping.ts` so the new mappings point at the new probes (`mcp-apps: ["mcp-apps"]`, `subagents: ["subagents"]`, `tool-rendering-default-catchall: ["tool-rendering-default-catchall"]`, `tool-rendering-custom-catchall: ["tool-rendering-custom-catchall"]`, `headless-complete: ["gen-ui-headless-complete"]`, `open-gen-ui-advanced: ["gen-ui-open-advanced"]`).

#### Phase-2B: Smoke probes to genuine

Replace each probe's keyword-match assertion with one that catches a real feature regression. Specific selectors are not prescribed — use whatever existing or new selector reliably catches the failure mode. Goal is "this probe turns red iff the feature breaks", not "this probe uses these exact testids".

| Probe                          | Demo URL                                                                                       | What to assert (behavior, not selector)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `d5-frontend-tools.ts`         | https://showcase-langgraph-python-production.up.railway.app/demos/frontend-tools               | 3 tests (one per pill: Sunset / Forest / Cosmic). For each, click the pill and assert the page background mutated to that pill's specific gradient (not just "changed off default" — Sunset must produce a sunset gradient, Forest a green gradient, Cosmic a navy→magenta gradient). May implement as 3 sequential turns in one probe (pill 1 → assert sunset bg; pill 2 → assert forest bg differs from sunset; pill 3 → assert cosmic bg differs from forest), OR split into `d5-frontend-tools-sunset.ts` / `-forest.ts` / `-cosmic.ts` per-pill probes mirroring the `d5-beautiful-chat-*.ts` pattern                                             |
| `d5-frontend-tools-async.ts`   | https://showcase-langgraph-python-production.up.railway.app/demos/frontend-tools-async         | After pill click, the async result card renders with non-empty content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `d5-agent-config.ts`           | https://showcase-langgraph-python-production.up.railway.app/demos/agent-config                 | 3 tests, one per config knob (tone / expertise / response length). For each: send a prompt with config A, capture the response; change config to value B via the form, send the same prompt, capture the response; assert the two responses differ in a way that's appropriate to the knob — tone A vs tone B = text differs (not byte-identical); expertise beginner vs expert = text differs; response length short vs long = character count differs by ≥ a configurable threshold. Aimock fixtures must produce distinct responses keyed on the context value (not just the user prompt); under real LLM on Railway the differentiation is natural |
| `d5-gen-ui-agent.ts`           | https://showcase-langgraph-python-production.up.railway.app/demos/gen-ui-agent                 | One test per pill (read pill list from `suggestions.ts`). Each test: click the pill, assert the step list renders with ≥2 steps. Different pills should produce different step content (locked via per-pill aimock fixtures) so a regression that returns the same canned step list for every pill is caught                                                                                                                                                                                                                                                                                                                                           |
| `d5-gen-ui-declarative.ts`     | https://showcase-langgraph-python-production.up.railway.app/demos/declarative-gen-ui           | One test per pill (read pill list from `suggestions.ts`). Each test: click the pill, assert the declarative catalog components render (Card / StatusBadge / Metric / etc. — whichever subset that pill exercises). Pills that exercise different catalog components should each be covered                                                                                                                                                                                                                                                                                                                                                             |
| `d5-gen-ui-a2ui-fixed.ts`      | https://showcase-langgraph-python-production.up.railway.app/demos/a2ui-fixed-schema            | After pill click, the fixed-schema component tree renders                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `d5-gen-ui-interrupt.ts`       | https://showcase-langgraph-python-production.up.railway.app/demos/gen-ui-interrupt             | Click pill, click the choice/confirm button on the rendered card, assert the agent resumes (next message visible OR state flips)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `d5-gen-ui-open.ts`            | https://showcase-langgraph-python-production.up.railway.app/demos/open-gen-ui                  | After pill click, an iframe renders with non-empty content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `d5-shared-state-streaming.ts` | https://showcase-langgraph-python-production.up.railway.app/demos/shared-state-streaming       | One test per pill (read pill list from `suggestions.ts` — currently only one pill is exercised; cover all of them). Each test: click the pill, assert the streaming-state UI updates mid-stream (character/word counter increments while streaming, or live indicator visible)                                                                                                                                                                                                                                                                                                                                                                         |
| `d5-readonly-state-context.ts` | https://showcase-langgraph-python-production.up.railway.app/demos/readonly-state-agent-context | Set a context value via the form, click pill, intercept outgoing agent request and assert the context field is in the body (network-payload via `page.route()`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

(The remaining smoke entries in the earlier Layer 2 audit overlap with Phase 2A splits. `d5-chat-slots.ts` is already genuine and stays out of scope here.)

If existing tests already pass and assert something equivalent, leave them alone — the goal is genuineness, not testid uniformity.

### Cross-cutting work

- **Phase 2 may add testids and pills to cells whose Layer 1 spec is already 🟢** (e.g. `agent-config`, `frontend-tools`, `gen-ui-agent`). Those additions go into production code so the Phase-2 D5 probe — running against real LLM on Railway — has a deterministic input pill and a deterministic side-effect testid to assert. The existing 🟢 Layer 1 spec continues to pass without rewrites.
- **No new abstractions:** do not create a "genuine-spec helper" library. The recipe is short and inlining keeps each spec readable.
- **No production-code changes** in Phase 1 beyond what each cell's End-state explicitly calls out. LangGraph agents, runtime providers — untouched.

## Risks

| Risk                                                                                                 | Mitigation                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aimock fixture key drift (test sends prompt X, fixture has X', test silently falls back to live LLM) | Add a `validate-fixture-tool-surface.ts` invariant that fails CI when a spec's `input.fill(prompt)` value has no matching fixture key. Existing script may already do something like this — extend if so. |
| Phase 1 testid additions conflict with existing testid usage elsewhere                               | Each new testid must be grep-checked across `showcase/` before commit; CI lint can grep for duplicate testids in the same demo route.                                                                     |
| Phase 2 depends on Phase 1; Phase 1 family PRs may land out of order                                 | Each Phase 1 family PR is independent (different cells, different files). Phase 2 lands only after all Phase 1 families are merged. Mark Phase 2 PR `blocked by` all Phase 1 PRs in the description.      |
| Iframe-only assertions for open-gen-ui cells leave the feature under-tested                          | User explicitly chose this trade-off. Document that as a follow-up: a postMessage spy or same-origin sandbox could deepen coverage later.                                                                 |

## Acceptance criteria

Phase 0:

- All 4 orphan specs deleted or renamed.
- Mapping has zero references to renamed/deleted demo IDs.
- `pnpm test` in `showcase/harness` green.
- Grep for the 4 deleted probes returns no live references.

Phase 1 (per family):

- The cell's tautological / unobservable assertions identified in this spec are removed.
- The cell's spec runs green in `pnpm playwright test --project=langgraph-python` against local aimock + LangGraph dev server.
- Any `.skip()` whose reason was Railway-flake or LLM-authoring is gone.
- Network-payload assertions (where prescribed) are wired via `page.route()` and the captured request body matches the expected shape.

Phase 2:

- All 4 wrong-target probes split.
- All 13 smoke probes converted to testid assertions.
- D5 fan-out on Railway for langgraph-python turns green and stays green over a 7-day window without flake.

## Sequencing

1. PR-A: Phase 0 (one PR).
2. PR-B: Phase 1A (interactivity: hitl-in-app + frontend-tools-async).
3. PR-C: Phase 1B (agent-state: readonly-state-agent-context).
4. PR-D: Phase 1C (gen-UI iframe: open-gen-ui, open-gen-ui-advanced).
5. PR-E: Phase 1D (multi-agent: subagents — also fixes 3 backend/UI bugs).
6. PR-F: Phase 1E (tool rendering: tool-rendering + tool-rendering-default-catchall + tool-rendering-custom-catchall — shared fixture-matcher fix covers all three; one PR for the triangle to keep the assertion-shape contract coherent).
7. PR-G: Phase 1F (headless: headless-simple + headless-complete — shared `headless-message-assistant` testid, same custom-bubble component; one PR keeps the headless contract coherent).
8. PR-H: Phase 2A (D5 wrong-target splits).
9. PR-I: Phase 2B (D5 smoke→genuine).

Each PR runs the showcase QA pipeline + the per-integration Playwright project before merge.

## Fixture / un-skip backlog (out of scope here)

These cells already test the right behavior. No assertions need rewriting. The only work is fixture coverage and `.skip()` removal — track separately:

- `agentic-chat` — already genuine.
- `multimodal` — already genuine.
- `byoc-hashbrown` — verify `d5-all.json` covers "Sales dashboard" / "Revenue by category" / "Expense trend".
- `byoc-json-render` — verify the same 3 pill messages have fixtures; remove the "Authored but not executed" caveat in the spec doc once exercised.
- `gen-ui-interrupt` — add aimock fixture entries for the 2 pill messages that emit a deterministic `interrupt()`; un-skip 2 tests.
- `mcp-apps` — add aimock fixture for the MCP activity-event path; un-skip 2 tests. Optionally add `[data-testid="mcp-app-iframe"]` for selector stability (cosmetic).

## Out-of-scope follow-ups

- Promote Layer 1 fixture coverage into D5 by hosting an aimock instance Railway services can opt into for staging. (Would let D5 probes themselves be deterministic.)
- Same genuine-pass for other integrations (`adk`, `agno`, `mastra`, `crewai-*`, etc.) — if successful here, port the recipe.
- Add a same-origin sandbox option for open-gen-ui so the iframe DOM can be introspected.
