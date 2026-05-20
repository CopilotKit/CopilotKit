# LangGraph-Python Column Wave 1 — Discovered Bugs & Descoped Cells

Wave 1 of the langgraph-python column completeness effort surfaced the
following issues while authoring QA checklists, E2E specs, and ops probes.
Each is tracked for follow-up separately from Wave 1's merge.

## How to read this

- **Descoped cell**: the Wave 1 "green the column" declaration explicitly
  excludes this cell. The dashboard will show amber/red for it until the
  underlying cause is addressed.
- **Follow-up**: the issue doesn't block Wave 1 completion; filed here for
  later.

Entries are grouped by area (docs, backend-agent, probe plumbing, frontend
/ CSS, test infra). Cross-references use the `W8-*` tag as it appears in
`docs/superpowers/plans/langgraph-python-column-wave1-bugs-scratch.md`
and in inline `// See W8-*` comments inside Playwright specs under
`showcase/packages/langgraph-python/tests/e2e/`.

## Bugs

### B1 — probe-docs.ts does not read `packages/*/docs-links.json` overrides (W8-1)

- **Symptom:** `scripts/probe-docs.ts` only validates URLs in
  `shared/feature-registry.json`. Per-integration overrides in
  `packages/<slug>/docs-links.json` are invisible to the probe, so
  `showcase/shell/src/data/docs-status.json` can report `notfound` for a
  URL that actually resolves 200 — and conversely a broken override would
  not show red.
- **Evidence:** Post-Task-1.4 probe aggregate is `ok=0 notfound=60 error=0
missing=16` even though every langgraph-python cell except
  `chat-customization-css` renders ✓/✓ on the dashboard. The dashboard
  flips to green via
  `showcase/shell-dashboard/src/components/cell-pieces.tsx:36-57` which
  trusts the override. Example: `og_docs_url`
  `https://docs.copilotkit.ai/langgraph/prebuilt-components` in
  `packages/langgraph-python/docs-links.json` is 200-verified but shows
  `notfound` in the probe output.
- **Suspected cause:** `probe-docs.ts` scope predates the
  `docs-links.json` override pattern; it reads only `REGISTRY_PATH` and
  never walks `packages/*/docs-links.json`.
- **Suggested owner:** showcase ops.
- **Next step:** either (a) extend `probe-docs.ts` to walk
  `packages/*/docs-links.json` and emit per-integration docs-status rows,
  or (b) teach `cell-pieces.tsx` to defer to probe state whenever a URL
  exists.
- **Descoped cell(s):** none — dashboard is already green via the
  override. Affects probe accuracy column-wide but not visible cell state.

### B2 — Every `/features/<id>` URL in feature-registry soft-404s (W8-3)

- **Symptom:** Every `https://docs.copilotkit.ai/features/<id>` entry in
  `shared/feature-registry.json` returns the Next.js catch-all
  `[[...slug]]` page. This affects integrations that don't ship a
  `docs-links.json` override.
- **Evidence:** Curl of any `/features/<id>` URL returns 200 with
  `x-matched-path: /[[...slug]]` or `/integrations/[[...slug]]`. Probe
  output's `notfound=60` aggregate is almost entirely these fallback
  URLs. See `docs/superpowers/plans/langgraph-python-docs-audit.md`
  surprise #3.
- **Suspected cause:** registry URLs were written against an older docs
  IA (`/features/<id>`) that no longer exists.
- **Suggested owner:** docs IA.
- **Next step:** short-term, ensure every integration has a
  `docs-links.json` override. Long-term, update feature-registry URLs to
  point at integration-specific pages or drop the feature-level fallbacks.
- **Descoped cell(s):** none for langgraph-python (overrides cover every
  cell). Other integration columns may still render red until each ships
  its own override.

### B3 — `chat-customization-css` has no dedicated docs page (W8-2)

- **Symptom:** langgraph-python ships a `chat-customization-css` demo but
  no dedicated CSS-customization page exists under docs.copilotkit.ai or
  shell-docs. The cell renders the "missing" state for og.
- **Evidence:**
  - `packages/langgraph-python/docs-links.json` entry for
    `chat-customization-css` has `og_docs_url: null` and
    `shell_docs_path: "/custom-look-and-feel/css"`.
  - `https://docs.copilotkit.ai/langgraph/custom-look-and-feel/css`
    soft-404s (catch-all `[[...slug]]`).
  - `https://docs.copilotkit.ai/custom-look-and-feel/css` also soft-404s.
  - No `integrations/langgraph/custom-look-and-feel/css.mdx` exists
    under `showcase/shell-docs/src/content/docs/` (a non-scoped
    `custom-look-and-feel/css.mdx` does exist, which shell resolution
    matches).
- **Suspected cause:** docs page was never authored.
- **Suggested owner:** docs.
- **Next step:** author `langgraph/custom-look-and-feel/css` (matching
  the `/slots` sibling) and the corresponding shell-docs mdx under
  `integrations/langgraph/custom-look-and-feel/css.mdx`. Then un-null
  `og_docs_url` in `packages/langgraph-python/docs-links.json`.
- **Descoped cell(s):** `chat-customization-css` docs-og.

### B4 — `reasoning_agent` non-responsive on Railway (W8-3 E2E)

- **Symptom:** `/demos/agentic-chat-reasoning` on
  `showcase-langgraph-python-production.up.railway.app` loads fine, but
  any typed prompt produces no `[data-testid="reasoning-block"]` and no
  `[data-role="assistant"]` bubble within 60s.
- **Evidence:**
  - Three consecutive E2E runs all time out at 60s on the
    reasoning-block locator.
  - Traces under
    `showcase/packages/langgraph-python/test-results/agentic-chat-reasoning-*`.
  - Same Railway host handles `frontend-tools` (5/5) and
    `frontend-tools-async` (2/3 LLM-dependent) — deployment is up; the
    `reasoning_agent` graph specifically is non-responsive.
  - Mitigation already landed in
    `showcase/packages/langgraph-python/tests/e2e/agentic-chat-reasoning.spec.ts`
    (three `test.skip`s with TODO).
- **Suspected cause:** `deepagents.create_deep_agent` /
  `init_chat_model` path in `src/agents/reasoning_agent.py` may be
  missing a Python dep or an OpenAI Responses-API permission on Railway,
  or the agent name mapping in `src/app/api/copilotkit/route.ts:76-77`
  (`agentic-chat-reasoning` → `reasoning_agent`) fails at the runtime
  layer.
- **Suggested owner:** showcase-langgraph-python deploy.
- **Next step:** tail Railway logs while hitting `/api/copilotkit` POST
  with an `agentic-chat-reasoning` agent run; confirm whether
  `reasoning_agent.graph` actually imports.
- **Descoped cell(s):** `agentic-chat-reasoning` E2E (reasoning-stream
  assertions skipped; page-load/submit-pipeline still live).

### B5 — `request_user_approval` does not fire on Railway within 60s (W8-5)

- **Symptom:** `/demos/hitl-in-app` on Railway loads fine; suggestion
  pills and the 3 ticket cards render. A typed prompt explicitly naming
  the tool and a ticket (e.g. "Use request_user_approval to ask me to
  approve a $50 refund on ticket #12345.") does not cause the agent to
  invoke the `useFrontendTool` handler. No
  `[data-testid="approval-dialog-overlay"]` portal appears; all three
  flows time out at 60s with two Playwright retries each.
- **Evidence:** traces under
  `showcase/packages/langgraph-python/test-results/hitl-in-app-*`.
  Mitigation in `tests/e2e/hitl-in-app.spec.ts` — three approval flows
  marked `test.skip` with TODO; page-load / ticket-card / suggestion-pill
  assertions remain live.
- **Suspected cause:** deployed `hitl_in_app_agent` graph may be missing
  the `request_user_approval` tool binding; or the agent-name mapping in
  `src/app/api/copilotkit/route.ts` does not route to a graph that
  receives frontend-tool registration; or the system prompt does not
  prime the model to call the tool for the typed prompt.
- **Suggested owner:** showcase-langgraph-python agent authoring /
  deploy.
- **Next step:** verify the HITL-in-app agent graph definition against
  the deployed image and confirm
  `useFrontendTool(request_user_approval)` is registered on the session
  by the time the user prompt is sent.
- **Descoped cell(s):** `hitl-in-app` E2E (approval flows skipped).

### B6 — `useInterrupt` / `schedule_meeting` does not fire on Railway within 60s (W8-6)

- **Symptom:** `/demos/gen-ui-interrupt` on Railway loads fine; suggestion
  pills render. Typed prompts naming the backend tool (e.g. "Use
  schedule_meeting to book an intro call …") do not trigger the
  `interrupt_agent` graph's `interrupt()` within 60s; no inline
  `[data-testid="time-picker-card"]` renders; both pick-a-slot and cancel
  flows time out.
- **Evidence:** traces under
  `showcase/packages/langgraph-python/test-results/gen-ui-interrupt-*`.
  Mitigation in `tests/e2e/gen-ui-interrupt.spec.ts` — two interrupt
  flows marked `test.skip` with TODO.
- **Suspected cause:** likely same cluster as B4 / B5. Either the
  `interrupt_agent` graph (shared with `interrupt-headless`) is not
  reaching its `interrupt()` on Railway, the `useInterrupt({
renderInChat: true })` primitive is not subscribing, or the
  `schedule_meeting` tool binding is stripped from the deployed graph.
- **Suggested owner:** showcase-langgraph-python agent authoring /
  deploy.
- **Next step:** hit `/api/copilotkit` with an `interrupt_agent` run
  while tailing Railway logs; confirm whether `schedule_meeting` is
  actually invoked and whether a LangGraph `interrupt()` is emitted on
  the SSE stream.
- **Descoped cell(s):** `gen-ui-interrupt` E2E (interrupt flows
  skipped).

### B7 — `readonly-state-agent-context` LLM round-trip stalls past 60s on Railway (W8-READONLY-1)

- **Symptom:** `/demos/readonly-state-agent-context` on Railway loads, but
  LLM round-trip for the "Who am I?" suggestion and the equivalent typed
  prompt stalls past 60s. There is no deterministic frontend tool
  side-effect to race against (the page simply expects an assistant
  bubble).
- **Evidence:** `showcase/packages/langgraph-python/tests/e2e/
readonly-state-agent-context.spec.ts` marks both the suggestion flow
  and the typed-prompt flow `test.skip` with an inline "See
  W8-READONLY-1" pointer at `readonly-state-agent-context.spec.ts:76,96`.
  Scratch file does not mention this entry — **scratch not updated**.
- **Suspected cause:** Railway round-trip flakiness; no frontend tool
  side-effect in the demo makes it impossible to distinguish slow-LLM
  from graph-dead.
- **Suggested owner:** showcase-langgraph-python agent authoring /
  deploy. Parallel: demo authoring could add an
  `data-testid="assistant-message"` marker on the assistant bubble to
  give the spec a deterministic structural signal.
- **Next step:** either fix the deployed agent's response latency or
  add the assistant-message testid so the spec can assert structural
  signal without waiting on LLM text.
- **Descoped cell(s):** `readonly-state-agent-context` E2E (LLM
  round-trip assertions skipped).

### B8 — `open-gen-ui` iframe mount regularly exceeds 120s (W8-OGUI-1)

- **Symptom:** `/demos/open-gen-ui` iframe mount exceeds the 120s
  per-test budget because the LLM has to author full HTML/CSS/JS before
  the iframe can paint. No reliable post-mount signal.
- **Evidence:** `showcase/packages/langgraph-python/tests/e2e/
open-gen-ui.spec.ts` marks both the Quicksort suggestion path and the
  neural-network path `test.skip` with "See W8-OGUI-1" at
  `open-gen-ui.spec.ts:64,90`. Scratch file does not mention this entry
  — **scratch not updated**.
- **Suspected cause:** demo is inherently LLM-authoring-bound. The
  iframe content is fully generated per request; there is no
  short-circuit signal (no testid on mount, iframe is srcdoc-loaded and
  opaque to the host).
- **Suggested owner:** showcase-langgraph-python demo authoring.
- **Next step:** emit a `data-testid="ogui-iframe"` on mount (short-
  circuits the LLM wait), or narrow the prompt to reduce authoring
  latency on Railway.
- **Descoped cell(s):** `open-gen-ui` E2E (iframe-mount assertions
  skipped).

### B9 — `open-gen-ui-advanced` sandbox iframe round-trip unverifiable (W8-OGUI-2)

- **Symptom:** `/demos/open-gen-ui-advanced` mounts an
  `sandbox="allow-scripts"`-only iframe; the round-trip to the host
  (e.g. the `notifyHost` console log) cannot be asserted via
  Playwright's `contentFrame()` because `allow-scripts`-only iframes
  restrict cross-frame interaction.
- **Evidence:** `showcase/packages/langgraph-python/tests/e2e/
open-gen-ui-advanced.spec.ts` marks the Ping mount and the
  `notifyHost` round-trip `test.skip` with "See W8-OGUI-2" at
  `open-gen-ui-advanced.spec.ts:63,92`. Scratch file does not mention
  this entry — **scratch not updated**.
- **Suspected cause:** shares B8's LLM-authoring latency; additionally
  the `allow-scripts` sandbox attribute by design prevents host-side
  introspection.
- **Suggested owner:** showcase-langgraph-python demo authoring.
- **Next step:** emit a post-mount testid or a host-visible console-log
  fixture the spec can assert against without crossing the sandbox
  boundary.
- **Descoped cell(s):** `open-gen-ui-advanced` E2E (sandbox-attribute and
  round-trip assertions skipped).

### B10 — `declarative-gen-ui` `generate_a2ui` secondary LLM stalls for KPI/StatusReport prompts (W8-7)

- **Symptom:** `/demos/declarative-gen-ui` KPI-dashboard and
  StatusReport pill flows regularly exceed 60s on Railway when the
  secondary LLM stage (which authors the a2ui JSON) stalls.
- **Evidence:** `showcase/packages/langgraph-python/tests/e2e/
declarative-gen-ui.spec.ts` marks the KPI test and the StatusReport
  test `test.skip` with "See W8-7" at `declarative-gen-ui.spec.ts:118,140`.
  Scratch file does not mention this entry — **scratch not updated**.
- **Suspected cause:** secondary LLM call in the `a2ui_dynamic` agent
  graph is slow/flaky on Railway. KPI is the slowest of the 4 pills.
- **Suggested owner:** showcase-langgraph-python agent authoring.
- **Next step:** measure secondary-LLM latency distribution on Railway;
  consider prompt shrinking or model swap for the secondary stage.
- **Descoped cell(s):** `declarative-gen-ui` E2E (KPI + StatusReport
  flows skipped; ProductCard and VideoCard pills remain live).

### B11 — `a2ui-fixed-schema` `display_flight` secondary LLM occasionally stalls (W8-8)

- **Symptom:** `/demos/a2ui-fixed-schema` `display_flight` flow
  occasionally stalls the secondary LLM stage past its 60s render
  budget.
- **Evidence:** `showcase/packages/langgraph-python/tests/e2e/
a2ui-fixed-schema.spec.ts:31` — inline comment "W8-8: on Railway,
  `display_flight` occasionally stalls the secondary LLM stage; render
  budget is 60s." Spec still runs against the 60s budget — not skipped,
  but flaky. Scratch file does not mention this entry — **scratch not
  updated**.
- **Suspected cause:** same secondary-LLM latency cluster as B10.
- **Suggested owner:** showcase-langgraph-python agent authoring.
- **Next step:** bundle with B10 investigation; possibly raise the
  render budget to 90s or switch the secondary stage model.
- **Descoped cell(s):** none — test still runs; flake is documented, not
  skipped.

### B12 — `mcp-apps` Excalidraw MCP iframe fails to paint within 90s (W8-9)

- **Symptom:** The end-to-end MCP round-trip (agent → `create_view` →
  server-side resource fetch → activity event → iframe render) on
  `/demos/mcp-apps` regularly sits above 90s and intermittently fails
  to paint an iframe at all when the Excalidraw MCP server is slow.
- **Evidence:** `showcase/packages/langgraph-python/tests/e2e/
mcp-apps.spec.ts` marks the flowchart flow and the explicit
  `create_view`-prompt flow `test.skip` with "See W8-9" at
  `mcp-apps.spec.ts:60,80`. Scratch file does not mention this entry —
  **scratch not updated**.
- **Suspected cause:** MCP Apps middleware latency or Excalidraw MCP
  upstream slowness.
- **Suggested owner:** showcase-langgraph-python deploy + MCP
  infrastructure.
- **Next step:** confirm whether the Excalidraw MCP server latency is
  the dominant factor; consider pre-warming or a cached-resource
  fallback.
- **Descoped cell(s):** `mcp-apps` E2E (round-trip flows skipped;
  presence + sandbox-contract assertions live).

### B13 — `query_notes` occasionally does not fire without explicit keyword verb (W8-4)

- **Symptom:** `/demos/frontend-tools-async` `query_notes` tool fires
  reliably when the user prompt contains an explicit "search my notes"
  verb phrase, but the "Find project-planning notes" suggestion pill and
  the typed variant "Find my notes about project planning." occasionally
  do not trigger the tool within 45s — the agent answers in-context
  without firing.
- **Evidence:** during e2e authoring, the pill-click variant and the
  typed-prompt variant both timed out waiting on
  `[data-testid="notes-card"]` at 45s. The "Search my notes for
  'auth'." typed variant and the zero-match "xyzzy-nonsense-keyword"
  variant succeeded reliably. Mitigation already landed in
  `showcase/packages/langgraph-python/tests/e2e/
frontend-tools-async.spec.ts` — pill test substitutes an explicit
  typed "Search my notes for 'auth'." prompt; terminal assertion accepts
  either `notes-list` or the empty-state copy.
- **Suspected cause:** `frontend_tools_async` graph's system prompt does
  not consistently bias the model towards `query_notes` for "find …
  notes" phrasing.
- **Suggested owner:** showcase-langgraph-python agent authoring.
- **Next step:** harden the system prompt to always prefer `query_notes`
  when the prompt contains "notes", or update the suggestion pill copy
  to begin with "Search my notes for …" verbatim.
- **Descoped cell(s):** none — test still runs after the pill→typed
  substitution; flake is documented, not skipped.

### B14 — `chat-customization-css` theme.css loses cascade on Railway

- **Symptom:** On Railway the `chat-customization-css` demo
  intermittently loses the custom dashed-border and theme cascade — the
  `theme.css` overrides for `--copilot-kit-*` variables don't win over
  the default stylesheet load order.
- **Evidence:** Memory-only from this session's dashboard walk (user
  note). Not captured in
  `tests/e2e/chat-customization-css.spec.ts` comments; the spec asserts
  `theme.css` CSS variables on the `.chat-css-demo-scope` wrapper but
  the reported Railway flake is about the dashed-border visual, not the
  computed variables. Scratch file does not mention this entry —
  **scratch not updated**.
- **Suspected cause:** stylesheet load order on Railway's Next.js
  production build differs from local — `theme.css` is imported but not
  guaranteed to load after the default CopilotKit stylesheet under
  certain chunk-splitting conditions.
- **Suggested owner:** showcase-langgraph-python demo authoring.
- **Next step:** reproduce on Railway with a deterministic trigger;
  confirm import order in the production bundle; if needed, hoist
  `theme.css` import or add a `@layer` wrapper to force cascade.
- **Descoped cell(s):** potentially `chat-customization-css` if the flake
  repros during Wave 1's final dashboard walk. Track but not
  pre-descoped.

### B15 — v2 `CopilotChatInput` Enter-key submit is flaky on slow networks

- **Symptom:** On slow networks the Enter-key submit path in v2
  `CopilotChatInput` intermittently drops the keystroke; tests using
  `page.keyboard.press("Enter")` after `fill()` flake. Workaround used
  across Wave 1 specs: click `[data-testid="copilot-send-button"]`
  instead.
- **Evidence:** every Wave 1 spec
  (`showcase/packages/langgraph-python/tests/e2e/*.spec.ts`) uses the
  `[data-testid="copilot-send-button"]` locator rather than Enter. No
  dedicated comment in-spec explains why, but the workaround is
  uniform. Memory-only from this session. Scratch file does not mention
  this entry — **scratch not updated**.
- **Suspected cause:** race between the controlled-input state update
  and the submit handler in v2 `CopilotChatInput` when Enter fires
  during an in-flight network tick.
- **Suggested owner:** v2 chat-input component (packages/).
- **Next step:** file an issue against the v2 chat-input package with a
  minimal repro; confirm whether the Enter handler awaits the latest
  controlled value.
- **Descoped cell(s):** none — workaround is trivial.

### B16 — `agentic-chat` suite fails against Railway: `background-container` testid absent

- **Symptom:** The `agentic-chat.spec.ts` suite asserts
  `[data-testid="background-container"]`, but on the deployed Railway
  demo that testid is not emitted — the deployed demo has drifted from
  source.
- **Evidence:** `showcase/packages/langgraph-python/tests/e2e/
agentic-chat.spec.ts:13,20,89` all use
  `page.locator('[data-testid="background-container"]')`. The source
  under `src/app/demos/agentic-chat/page.tsx` does render the testid,
  but the Railway image appears to be from before a recent edit. Memory-
  only from this session. Scratch file does not mention this entry —
  **scratch not updated**.
- **Suspected cause:** Railway build is stale relative to the source
  tree; redeploy needed, or the deployed branch diverges from the
  worktree.
- **Suggested owner:** showcase-langgraph-python deploy.
- **Next step:** redeploy Railway from current HEAD; re-run the
  `agentic-chat.spec.ts` suite and confirm all assertions pass.
- **Descoped cell(s):** `agentic-chat` E2E remains pending a redeploy —
  track but not pre-descoped pending the Wave 1 post-merge dashboard
  walk.

### B17 — `chat-slots` manifest `highlight` list omits two components

- **Symptom:** `packages/langgraph-python/manifest.yaml` `chat-slots`
  entry lists only `custom-welcome-screen.tsx` under `highlight:`. The
  demo actually uses three custom slot components:
  `custom-assistant-message.tsx` and `custom-disclaimer.tsx` are missing
  from the highlight list.
- **Evidence:**
  - `showcase/packages/langgraph-python/manifest.yaml:268-276`
    (`chat-slots` entry highlight list).
  - `showcase/packages/langgraph-python/src/app/demos/chat-slots/`
    contains `custom-assistant-message.tsx`, `custom-disclaimer.tsx`,
    `custom-welcome-screen.tsx`, and `page.tsx`.
  - Does not affect the dashboard (highlight list is not dashboard-
    consumed for this column). Minor hygiene only.
- **Suspected cause:** original manifest author added the first slot
  component and later additions were not back-filled.
- **Suggested owner:** showcase-langgraph-python demo authoring.
- **Next step:** add the two missing files to the `highlight:` array.
- **Descoped cell(s):** none.

## Summary

- **Total W8 / Wave 1 bug entries:** 17 (B1–B17).
- **Descoped cells from Wave 1 completeness:** 7 —
  `chat-customization-css` (docs-og, via B3),
  `agentic-chat-reasoning` (E2E, via B4),
  `hitl-in-app` (E2E, via B5),
  `gen-ui-interrupt` (E2E, via B6),
  `readonly-state-agent-context` (E2E, via B7),
  `open-gen-ui` (E2E, via B8),
  `open-gen-ui-advanced` (E2E, via B9),
  plus partial descoping of `declarative-gen-ui` E2E (2 of 4 pills, via
  B10) and `mcp-apps` E2E (round-trip flows only, via B12).
- **Follow-up-only (no cell impact):** 8 — B1, B2, B11, B13, B14, B15,
  B16, B17.

Entries B7–B12 and B14–B17 were captured in-code (Playwright spec
comments, manifest, and session memory) but were not synced back to
`docs/superpowers/plans/langgraph-python-column-wave1-bugs-scratch.md`
during Wave 1. The scratch file currently covers only W8-1, W8-2, W8-3
(docs), W8-3 (E2E), W8-4, W8-5, and W8-6.
