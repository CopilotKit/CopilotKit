# QA: A2UI Error Recovery — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/a2ui-recovery` on the dashboard host
- Next.js host is healthy (`GET /api/health`); the Python backend is reachable (`GET /api/copilotkit` reports `agent_status: "reachable"`); `ANTHROPIC_API_KEY` is set. `AGENT_URL` (default `http://localhost:8000`) points at `src/agent_server.py`, which exposes `@app.post("/a2ui-recovery")` → `run_a2ui_recovery_agent`. There is **no** LangGraph deployment in this integration
- **The recovery loop is NATIVE here.** The langgraph-python reference owns `generate_a2ui` via `ag_ui_langgraph.get_a2ui_tools` and runs the validate→retry loop inside the toolkit. claude-sdk-python uses its own adapter (`ag-ui-claude-sdk` + `claude-agent-sdk`) and does not depend on `ag_ui_langgraph` / `ag_ui_a2ui_toolkit`, so `src/agents/recovery_agent.py` re-implements the loop: `_validate_a2ui_components` (structural checks — `empty_components`, `missing_id`, `missing_component_type`, `unresolved_child`, `no_root`) driven by `_run_render_with_recovery` with `MAX_A2UI_ATTEMPTS = 3`, one inner `render_a2ui` Claude call **per attempt**, and `_wrap_recovery_exhausted_envelope` returning `{"error": …, "code": "a2ui_recovery_exhausted", "attempts": [...]}` on cap
- Backend-owned wiring: `src/app/api/copilotkit-a2ui-recovery/route.ts` sets `injectA2UITool: false` (load-bearing — the backend owns `generate_a2ui`, whose only argument is `intent`) plus `defaultCatalogId: "declarative-gen-ui-catalog"`
- Reuses the **declarative-gen-ui** catalog (`myCatalog`, `catalogId: "declarative-gen-ui-catalog"`) and the Vantage Threads sales context (`useSalesAnalystContext`) — no new components
- The `building` / `retrying` / `failed` lifecycle chrome comes from `@copilotkit/react-core/v2` (`A2UIRecoveryStates.tsx`, mounted by `A2UIMessageRenderer`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/a2ui-recovery`; verify the page renders within 3s and a single `CopilotChat` pane is centered (`max-w-4xl`, `rounded-2xl`, full viewport height)
- [ ] Verify the chat is wired to `runtimeUrl="/api/copilotkit-a2ui-recovery"` and `agent="a2ui-recovery"` (DevTools → Network: sending a message hits that endpoint, not `/api/copilotkit`)
- [ ] Verify both suggestion pills are visible with verbatim titles:
  - "Recover a bad render"
  - "Show an unrecoverable failure"

### 2. Healing path

- [ ] Click "Recover a bad render" ("Build my Q2 revenue summary and self-correct a malformed first attempt.")
- [ ] Attempt 1 of the inner `render_a2ui` returns a **structurally invalid** surface (`root` lists a child id that no component defines → `unresolved_child`). Verify the native loop rejects it, retries, and attempt 2 paints — no broken surface, no error banner. A "Building interface" skeleton is expected; the "Retrying generation… (N/M attempts)" sub-label is threshold-gated (2 attempts / 2000ms) so it may or may not become visible — do not fail the run on its absence
- [ ] Verify the **painted** surface is valid: at least two `declarative-metric` tiles — "QUARTERLY REVENUE / $4.2M / ↑ +12% QoQ" and "WIN RATE / 31% / ↓ -2 pts"
- [ ] DevTools → Network: verify the `generate_a2ui` tool result carries an `a2ui_operations` container (and **no** `a2ui_recovery_exhausted`)
- [ ] Verify the chat reply is one short sentence noting the heal
- [ ] If backend stdout is reachable, verify two `[a2ui recovery] attempt N: …` log lines — attempt 1 `invalid` with an `unresolved_child` error, attempt 2 `valid` (emitted by `_log_attempt` on the `agents.recovery_agent` logger)

### 3. Hard-fail (recovery exhausted) path

- [ ] Click "Show an unrecoverable failure" ("Build a report that fails every validation pass so I can preview the fallback.")
- [ ] Verify the lifecycle ends in the tasteful `failed` card — amber panel reading "Couldn't generate the UI" over "Something went wrong rendering this. You can keep chatting and try again." — and NOT a broken/half-rendered surface, and NOT a silent drop. No new `declarative-metric` tile may appear for this pill
- [ ] DevTools → Network: verify `render_a2ui` was attempted up to the cap (3 attempts, all invalid) and the `generate_a2ui` result is an `a2ui_recovery_exhausted` envelope with a 3-entry `attempts` array (no `a2ui_operations` painted)
- [ ] Verify the chat reply gracefully explains the fallback (one short sentence)

### 4. Regression / isolation

- [ ] Verify the recovery demo does not affect the `declarative-gen-ui` or `beautiful-chat` demos (separate routes and agents, even though the catalog is shared)
- [ ] Re-run each pill a second time and verify the same lifecycle

## Notes

- The malformed renders are forced by aimock fixtures (`showcase/aimock/d6/claude-sdk-python/a2ui-recovery.json`): the inner `render_a2ui` calls are matched by `userMessage` + `toolName=render_a2ui` (+ `sequenceIndex` 0/1 for the heal pill's two attempts), and the outer narration by the emit's unique `toolCallId`. The retry DECISION is made live by the native loop in `recovery_agent.py` — the fixture only supplies the render args.
- The pill prompts are unique per integration on purpose: the inner `render_a2ui` calls carry no `x-aimock-context`, so identical prompts across integrations would collide in the shared aimock matcher. Keep `src/app/demos/a2ui-recovery/suggestions.ts` in sync with `showcase/harness/src/probes/scripts/d5-a2ui-recovery.ts`.
- Heads-up on a stale comment: `suggestions.ts` still describes the heal as `parse_and_fix` healing sloppy JSON-string args in one pass. That is the toolkit's mechanism, not this integration's. Here the heal is a genuine **invalid → retry → valid** two-attempt loop; the fixture `_comment` fields are authoritative.
