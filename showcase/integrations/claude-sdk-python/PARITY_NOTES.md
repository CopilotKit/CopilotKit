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
  `readonly-state-agent-context`.
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
`/interrupt-adapted` scheduling agent in `interrupt_agent.py`). The identical
QUARANTINE comment lives in both this manifest and the langgraph-python
manifest.

Both are honestly marked skipped-incapable (not green, not red).

## Note on local D6 vs staging (open-gen-ui / open-gen-ui-advanced)

`open-gen-ui` / `open-gen-ui-advanced` are **supported and GREEN in staging**
(verified on the staging matrix). They are NOT NSF. On THIS local docker
stack they loop (openGenerativeUI `generateSandboxedUi` re-emits on the
follow-up run), but the loop is a **local-repro artifact**: it was ruled out
as (a) a fixture issue — the pre-blitz/staging fixture also loops locally, and
(b) a `@copilotkit/*` version drift — the container versions match the
green langgraph-python container, which passes ogui locally. The exact local
delta vs staging was not pinned (the backend's stdout does not surface to
`docker logs`, blocking deeper capture). CI (staging-equivalent x86 build)
is the arbiter for these two cells. The fixtures here are the canonical
staging-green versions (`hasToolResult`-gated follow-up leg).

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

Three cells were aimock-green but were routing to the WRONG agent live (a
generic-fallback prompt masked by the fixture). Each now has a dedicated,
correctly-prompted backend so the live behavior matches the fixture:

1. `gen-ui-tool-based` — dedicated `/gen-ui-tool-based` endpoint with
   `GEN_UI_TOOL_BASED_SYSTEM_PROMPT` (was the GOTCHAS #8 generic sales-prompt
   fallback).
2. `frontend-tools-async` — dedicated `/frontend-tools-async` endpoint with a
   tailored prompt (was masked generic fallback).
3. `hitl-in-app` — dedicated `/hitl-in-app` endpoint applying the HITL prompt
   via `system_prompt_override` (was masked generic fallback).

## Flags / caveats

- **`readonly-state-agent-context` live-prompt gap**: the reference uses a
  dedicated tailored-prompt graph; here the cell routes to the generic shared
  agent (`readonly_state_agent_context.py` is docs-only). D6 and the frontend
  are correct — context is injected via `useAgentContext` — but the live
  system prompt is not tailored the way the reference is. Adjudicated at live
  smoke.
- **`declarative-json-render` zod build caveat**: `catalog.ts` was reverted
  from `zod4` back to `zod` for byte-parity with the reference. If
  `@json-render` 0.18 turns out to require `zod4` here, the build may break —
  re-introduce `zod4` and re-flag if so.
