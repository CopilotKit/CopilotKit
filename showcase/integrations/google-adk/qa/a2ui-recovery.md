# QA: A2UI Error Recovery — Google ADK (ADK-only)

## Prerequisites

- Demo is deployed and accessible at `/demos/a2ui-recovery` on the dashboard host
- Agent backend is healthy (`/api/health`); `GOOGLE_API_KEY` is set; `AGENT_URL` points at the ADK agent server exposing the `a2ui_recovery` agent path (registered as agent name `a2ui-recovery` — see `src/app/api/copilotkit-a2ui-recovery/route.ts`)
- Requires `ag-ui-adk >= 0.7.0` (the validate→retry recovery loop + `a2ui_recovery_exhausted` hard-fail envelope) and `@ag-ui/a2ui-middleware >= 0.0.10` (the `building`/`retrying`/`failed` lifecycle rendering)
- Backend-owned wiring: the route sets `injectA2UITool: false`; the agent owns `generate_a2ui` via `get_a2ui_tool({ recovery: { maxAttempts: 3 } })` (see `src/agents/recovery_agent.py`)
- Reuses the **declarative-gen-ui** catalog (`catalogId: "declarative-gen-ui-catalog"`) and the Vantage Threads sales context — no new components
- This demo is **ADK-only**: the recovery loop lives in the ADK middleware; the langgraph-python runtime path has no equivalent, so there is no langgraph-python parity reference for this demo (it is exempt from the LP e2e-parity comparison)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/a2ui-recovery`; verify the page renders within 3s and a single `CopilotChat` pane is centered (max-width ~896px, rounded-2xl, full-height)
- [ ] Verify the chat is wired to `runtimeUrl="/api/copilotkit-a2ui-recovery"` and `agent="a2ui-recovery"` (DevTools → Network: sending a message hits that endpoint, not `/api/copilotkit`)
- [ ] Verify both suggestion pills are visible with verbatim titles:
  - "Recover a bad render"
  - "Show an unrecoverable failure"

### 2. Healing path

- [ ] Click "Recover a bad render" ("Render my Q2 sales dashboard, recovering if the first attempt is malformed.")
- [ ] The inner `render_a2ui` returns **free-form / sloppy** A2UI args (components & data as JSON strings rather than structured arrays). Verify the middleware **heals** them via `parse_and_fix` into a valid surface that paints (no broken surface, no error banner)
- [ ] Verify the **painted** surface is valid: a `declarative-metric` row ("Quarterly Revenue $4.2M", "Win Rate 31%") — i.e., the sloppy render was repaired and rendered
- [ ] DevTools → Network: verify the final tool result carries an `a2ui_operations` container (no `a2ui_recovery_exhausted`)
- [ ] Verify the chat reply is one short sentence noting the heal

### 3. Hard-fail (recovery exhausted) path

- [ ] Click "Show an unrecoverable failure" ("Render a dashboard that keeps failing validation so I can see the fallback.")
- [ ] Verify the lifecycle ends in a tasteful `failed` state (NOT a broken/half-rendered surface and NOT a silent drop)
- [ ] DevTools → Network: verify `render_a2ui` was attempted up to the cap (3 attempts, all invalid) and the tool returned an `a2ui_recovery_exhausted` envelope (no `a2ui_operations` painted)
- [ ] Verify the chat reply gracefully explains the fallback (one short sentence)

### 4. Regression / isolation

- [ ] Verify the recovery demo does not affect the declarative-gen-ui or beautiful-chat demos (separate routes/agents)
- [ ] Re-run each pill a second time and verify the same lifecycle

## Per-pill fixture selection (how the two pills stay distinct under aimock)

> Both pills run against the same inner `render_a2ui` tool, but ag_ui_adk >= 0.7.0 forwards the run's conversation into that inner call, so the **last user turn aimock keys on is the pill prompt** (the generic A2UI render guidance rides as the system prompt, not the matched user message). Each pill therefore matches its **own** inner fixture by `userMessage`: HEAL → the free-form/healable fixture, EXHAUST → the always-invalid one. Verified against the aimock journal (HEAL → `call_d6_recover_heal_design`; EXHAUST → `call_d6_recover_exhaust_design`, called 3× for the retry loop). All three e2e tests (page-load, heal, exhaust) pass under aimock.

## Notes

- The malformed renders are forced by aimock fixtures (`showcase/aimock/d6/google-adk/a2ui-recovery.json`): the inner `render_a2ui` call is matched by `userMessage` + `toolName=render_a2ui`. Healing itself is performed live by the ADK middleware, not the fixture.
- This demo is ADK-only (the recovery loop lives in the `ag_ui_adk` middleware; langgraph-python's runtime A2UI path has no equivalent). OSS-375 tracks LP parity.
