# Parity Notes

Baseline reference: `showcase/integrations/langgraph-python/` (the north-star
integration). The milestone for OSS-578 is that this integration's grid
demonstrates the SAME feature set, in the SAME order, with the SAME overview
taxonomy as langgraph-python — so a viewer sees an honest apples-to-apples grid
across every integration.

## Frontend parity

The frontend render surface is **byte-identical to langgraph-python modulo
integration identity** — the only intentional diffs are doc comments, the
console log slug prefix (`claude-sdk-python`), and framework-snippet files.
Every `page.tsx`, renderer, card, hook, and slot file under
`src/app/demos/**` is the canonical langgraph-python file re-keyed to this
integration. All D6 aimock fixtures were re-mirrored from the canonical
langgraph-python fixtures and re-keyed to `context=claude-sdk-python`.

The `manifest.yaml` `features:` list and `demos:` order/taxonomy
(`name` / `description` / `tags`) are aligned 1:1 with langgraph-python.
The `highlight:` file lists reference this integration's ACTUAL files: frontend
paths are identical to the reference; backend paths point at the Claude Agent
SDK modules under `src/agents/` (many demos are served by the shared
`src/agents/agent.py` with per-demo system-prompt / tool-set overrides applied
in `src/agent_server.py`, rather than a dedicated per-demo graph module).

## GREEN cells

All of the following are wired to the correct Claude Agent SDK backend and are
frontend-aligned with the reference:

- **Chat surfaces**: `agentic-chat`, `beautiful-chat`, `prebuilt-sidebar`,
  `prebuilt-popup`, `chat-slots`, `chat-customization-css`, `headless-simple`,
  `headless-complete`. Served by the shared `agent.py` (headless surfaces are
  frontend-only compositions over `useAgent`).
- **Reasoning**: `reasoning-default`, `reasoning-custom`,
  `tool-rendering-reasoning-chain` — dedicated `/reasoning` and
  `/tool-rendering-reasoning-chain` endpoints emit native Claude
  `thinking_delta` blocks translated to AG-UI `REASONING_MESSAGE_*` events.
- **Tool rendering / gen UI**: `tool-rendering`, `tool-rendering-default-catchall`,
  `tool-rendering-custom-catchall`, `gen-ui-agent`, `gen-ui-tool-based`,
  `open-gen-ui`, `open-gen-ui-advanced`.
- **Frontend tools**: `frontend-tools`, `frontend-tools-async`.
- **Human-in-the-loop**: `hitl-in-chat` (dedicated `/hitl-in-chat`),
  `hitl-in-app` (dedicated `/hitl-in-app`).
- **Shared state**: `shared-state-read`, `shared-state-read-write`
  (dedicated `/shared-state-read-write`, emits `StateSnapshot`),
  `shared-state-streaming` (per-token deltas),
  `readonly-state-agent-context` (dedicated `/readonly-state-agent-context`,
  `tools=[]` + read-only-context prompt — see "Masking fixes landed").
- **Multi-agent**: `subagents` (dedicated `/subagents`, delegations via
  `STATE_SNAPSHOT`).
- **Declarative UI**: `declarative-gen-ui` (A2UI dynamic),
  `a2ui-fixed-schema` (A2UI fixed + `flight_schema.json`),
  `a2ui-recovery` (see below), `declarative-hashbrown` (`@hashbrownai/react`),
  `declarative-json-render` (`@json-render/react`).
- **Platform**: `mcp-apps` (dedicated `/mcp-apps`), `multimodal`
  (`convert_part_for_claude`, `pypdf`), `voice` (guarded transcription),
  `agent-config` (repacks provider `properties` into `configurable`),
  `auth` (V2 `createCopilotRuntimeHandler`, bearer 401).
- `cli-start` — manifest-only entry (framework-slug init command); no demo dir.

## NSF cells (not-supported, quarantined)

Two cells are marked `not_supported_features` in the manifest — **not
regressions in this integration**. They fail on a shared upstream react-core
resume-path defect that also affects the reference:

- `gen-ui-interrupt` — turn-2 resume-path bug in
  `@copilotkit/react-core/v2` `useInterrupt`: the backend resumes and streams
  (HTTP 200) but the frontend never appends the confirmation assistant bubble,
  so the harness DOM settle-check times out.
- `interrupt-headless` — same shared react-core resume-path bug via
  `useHeadlessInterrupt`.

Both demos remain wired (frontend byte-aligned; backend on the shared
`/interrupt-adapted` scheduling agent in `interrupt_agent.py`).

### Correction: the upstream bug is NOT the only blocker here

The shared react-core defect above is real and blocks the reference too, but for
THIS integration it is not the whole story, and the earlier wording (which cited
only the upstream bug, and framed these as "not regressions in this
integration") was incomplete. The two halves of these cells expect DIFFERENT
mechanisms:

- The **backend** (`src/agents/interrupt_agent.py`) implements "Strategy B",
  mirroring `ms-agent-python`: the Claude Agent SDK has no `interrupt()`
  primitive, so the agent calls a frontend tool named `schedule_meeting`. Its
  docstring states "The frontend registers the tool via `useFrontendTool`", and
  it forwards frontend-defined tools.
- The **frontend** is the byte-identical langgraph-python copy and uses
  `useInterrupt` — the low-level primitive for LangGraph `interrupt(...)`
  events. Nothing in `gen-ui-interrupt/` or `interrupt-headless/` registers
  `schedule_meeting` via `useFrontendTool` (grep returns nothing), so the
  backend's tool call has no client implementation, and no interrupt payload is
  ever produced for `useInterrupt` to consume.

The reference is internally consistent (real `interrupt()` in
`langgraph-python/src/agents/interrupt_agent.py`, paired with `useInterrupt`).
Note that `_shared/interrupt-fallback-slots.ts` does NOT rescue this: it only
fills in missing slots WITHIN an interrupt payload, and no such payload arrives.

Closing this locally would mean either diverging the frontend (violating the
near-identical-frontend rule) or teaching the backend to emit real interrupt
events — net-new feature work this ticket explicitly excludes. Per the ticket's
own rule ("if a declared cell can't go green without new-feature/upstream work,
reclassify to honest NSF — never force"), both cells stay NSF, but the reason
recorded here is now the accurate one. Even if the react-core fix ships, these
two cells will still need local work before they can go green.

Both are honestly marked skipped-incapable (not green, not red).

## Note on local D6 vs staging (open-gen-ui / open-gen-ui-advanced)

`open-gen-ui` / `open-gen-ui-advanced` are **supported and GREEN in staging**
(verified on the staging matrix). They are NOT NSF. On THIS local docker
stack they loop (openGenerativeUI `generateSandboxedUi` re-emits on the
follow-up run), but the loop is a **local-repro artifact**: it was ruled out
as (a) a fixture issue — the pre-blitz/staging fixture also loops locally, and
(b) a `@copilotkit/*` version drift — the container versions match the
langgraph-python container. The exact local delta vs staging was not pinned
(the backend's stdout does not surface to `docker logs`, blocking deeper
capture). CI (staging-equivalent x86 build) is the arbiter for these two
cells. The fixtures here are the canonical staging-green versions
(`hasToolResult`-gated follow-up leg).

**Correction (measured 2026-08-31):** an earlier version of this note claimed
langgraph-python "passes ogui locally", making the failure look
claude-sdk-python-specific. That is not true on the current local stack. A
control run of the REFERENCE's own cell —
`bin/showcase test langgraph-python:open-gen-ui --d6 --direct --isolate …` —
also goes RED (`gen-ui-open: feature exceeded 300000ms wall-clock`, with
`ERR_NETWORK_IO_SUSPENDED`, `agent_run_failed`, and a streamed-JSON parse
error). So the local docker stack cannot adjudicate `open-gen-ui` for ANY
integration, the reference included. Treat local ogui results as
uninformative and rely on CI/staging, until someone pins the local delta.

## Note on local D6 vs staging (multimodal)

`multimodal` also cannot be verified on a local checkout that has not resolved
Git LFS. `public/demo-files/sample.png` and `sample.pdf` are LFS pointers; the
demo detects this and refuses to send, so the probe fails with
`settle-dom-missing` and the page prints "Sample \"sample.png\" is a Git LFS
pointer, not the real asset." This is NOT a cell defect — nothing in this
integration's `public/` was changed. CI resolves the assets explicitly
(`.github/workflows/showcase_validate.yml`:
`git lfs pull --include="showcase/integrations/*/public/demo-files/*"`, which
hard-errors if the pull no-ops), so the cell is verifiable there. To verify
locally you need `git-lfs` installed plus that pull.

## a2ui-recovery — native recovery loop

`a2ui-recovery` is implemented natively for the Claude Agent SDK rather than
reusing `ag_ui_langgraph`. `src/agents/recovery_agent.py` runs its OWN adapter
that drives the A2UI validate → retry loop (heal / retry / exhaust): an invalid
first render heals to a valid one, and an always-invalid render surfaces a
graceful recovery-exhausted fallback. Backend-owned via `get_a2ui_tools`
(`injectA2UITool=false`); it reuses the `declarative-gen-ui` catalog. Wired to
the dedicated `/api/copilotkit-a2ui-recovery/route.ts` frontend route and the
`/a2ui-recovery` backend endpoint. HEAL-attempt distinction relies on the
aimock `sequenceIndex`.

## Masking fixes landed

Four cells were aimock-green but were routing to the WRONG agent live (a
generic-fallback prompt masked by the fixture). Each now has a dedicated,
correctly-prompted backend so the live behavior matches the fixture:

1. `gen-ui-tool-based` — dedicated `/gen-ui-tool-based` endpoint with
   `GEN_UI_TOOL_BASED_SYSTEM_PROMPT` (was the GOTCHAS #8 generic sales-prompt
   fallback).
2. `frontend-tools-async` — dedicated `/frontend-tools-async` endpoint with a
   tailored prompt (was masked generic fallback).
3. `hitl-in-app` — dedicated `/hitl-in-app` endpoint applying the HITL prompt
   via `system_prompt_override` (was masked generic fallback).
4. `readonly-state-agent-context` — dedicated `/readonly-state-agent-context`
   endpoint applying the read-only-context prompt with `tools_override=[]`
   (mirrors the reference's `tools=[]` graph). This one was the starkest
   masking case: `src/agents/readonly_state_agent_context.py` was imported
   NOWHERE, yet `manifest.yaml` lists it under this demo's `highlight:` block
   and the integration is `docs_mode: generated` — so the published docs
   presented a module as this cell's backend that the runtime never executed.
   Verified via aimock's request recorder (`GET /v1/_requests`), which captures
   the system prompt the fixture matcher ignores:
   - BEFORE: generic sales-assistant `SYSTEM_PROMPT`, 9 backend tools, and
     `POST /readonly-state-agent-context` → HTTP 404 (the path did not exist).
   - AFTER: the read-only-context prompt carrying the probe's context sentinel,
     0 tools, and the path serving HTTP 200.
     D6 was green BEFORE and AFTER — which is the point: the probe cannot see
     this defect (GOTCHAS #8).

## Verification-surface parity (specs + QA docs)

`scripts/validate-parity.ts` now reports this integration at **39 demos / 39
e2e specs / 40 QA docs with 3 warnings — identical to langgraph-python**, up
from 39 / 36 / 31 with 21 warnings. The 3 remaining warnings are byte-identical
to the reference's own (`interrupt-headless` has no spec, `reasoning-custom` has
no QA doc, and the stale demo-count baseline); closing those only here would
break the identical-tests rule.

Work that got it there:

- Ported the 4 missing specs (`a2ui-recovery`, `reasoning-custom`,
  `reasoning-default`, `threadid-frontend-tool-roundtrip`).
- Renamed `byoc-hashbrown` / `byoc-json-render` spec+QA files to
  `declarative-*` to match the demo ids (`validate-parity` keys filenames to
  demo ids). Python module names KEEP the `byoc_` prefix — the reference does
  too, and `manifest.yaml` cites them under `highlight:`.
- Deleted the orphan `shared-state-write` spec+QA pair (no such demo dir, no
  manifest entry).
- Authored the 10 missing QA docs in the reference's own cut: full checklists
  where it has them, `> Stub — authored for column completeness` where it
  deliberately stubs (`interrupt-headless`, `reasoning-default`,
  `tool-rendering-reasoning-chain`). Every file path, env var, endpoint,
  `data-testid` and quoted prompt in them was verified to exist.

### Two specs were not merely drifted — they were dead

- `declarative-gen-ui.spec.ts` asserted suggestion pills that no longer exist
  ("Show a KPI dashboard", "Pie chart — sales by region", …) against the
  current Vantage Threads set ("Show my sales dashboard", "Team performance",
  "Anything at risk?", "Top account details"), and its header comment claimed
  the demo has no `data-testid` — false: the same seven ids the reference uses
  are present. It could only ever have failed; nobody noticed because `--d6`
  never invokes this surface (GOTCHAS #7). Rewritten onto the stable testids.
- `beautiful-chat.spec.ts` had the `Catalog not found` regression guard
  (#4733 / #4734 / #5425) nested inside a conditional, so a regression could
  slip past. Hoisted to the reference's unconditional placement.

## Flags / caveats

- **`beautiful-chat` is weaker by FIXTURE, not by test.** After the fix above
  the test logic is byte-identical to the reference; the one remaining
  divergence is a comment, and it is deliberate. The reference's fixture omits
  `catalogId` so the run exercises route-level `defaultCatalogId` resolution —
  the exact path that regressed in #4733 / #4734 / #5425. This integration's
  `aimock/d4/claude-sdk-python/chat.json` hardcodes
  `catalogId: "copilotkit://app-dashboard-catalog"`, so that path is never
  exercised here. Copying the reference's comment verbatim would have stated
  something false about our fixture. Our route already configures the same
  `defaultCatalogId`, so aligning the fixture (dropping the explicit id) is a
  small, viable follow-up in the fixture lane.
- **`declarative-json-render` zod caveat — RESOLVED.** `catalog.ts` imports
  plain `zod`, matching the reference, which now does the same. No action.
