# QA: A2UI Error Recovery — Google Antigravity

## Prerequisites

- Demo is deployed and accessible at `/demos/a2ui-recovery` on the dashboard host
- Agent backend is healthy (`/api/health`); `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set (the Go harness calls Gemini itself, and `generate_a2ui` makes its own Gemini call; `GOOGLE_GEMINI_BASE_URL` points both at aimock in tests)
- The page uses its own runtime route, `/api/copilotkit-a2ui-recovery`, which proxies agent `a2ui-recovery` to the agent server's `/a2ui_recovery` mount, bound in `src/agents/registry.py` to `a2ui_recovery_agent()` from `src/agents/a2ui_recovery.py`. The route sets `injectA2UITool: false` and `defaultCatalogId: "declarative-gen-ui-catalog"`.
- Backend-owned recovery: the agent uses the same `generate_a2ui` server tool as declarative-gen-ui (`src/agents/a2ui_dynamic.py`). Each forced `render_a2ui` Gemini call is validated structurally; on failure the tool retries with the validation errors appended to the prompt, up to 3 attempts. It returns an `a2ui_operations` envelope on success, or the `a2ui_recovery_exhausted` envelope once every attempt failed, which the A2UI middleware shows as a "Couldn't generate the UI" failure card.
- Differences from the reference: the surface arrives whole in the `TOOL_CALL_RESULT`, so there is no progressive "building" stream and no "Retrying… (N/M)" state between attempts — the retries happen inside the tool call.
- Reuses the **declarative-gen-ui** catalog (`catalogId: "declarative-gen-ui-catalog"`) and the Vantage Threads sales context — no new components
- The pills are deterministic only against aimock (`showcase/aimock/d6/google-antigravity/a2ui-recovery.json`): heal returns an invalid first render (the root references a missing child) and a valid one once the retry prompt carries "## Previous attempt was invalid"; exhaust is invalid on every attempt. Against real Gemini the model may render validly on the first try.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/a2ui-recovery`; verify the page renders within 3s with a single `CopilotChat` pane centered (max-width 4xl, rounded-2xl, full height)
- [ ] Verify the chat is wired to `runtimeUrl="/api/copilotkit-a2ui-recovery"` and `agent="a2ui-recovery"` (DevTools → Network: sending a message hits that endpoint, not `/api/copilotkit`)
- [ ] Verify both suggestion pills are visible with verbatim titles:
  - "Recover a bad render"
  - "Show an unrecoverable failure"

### 2. Healing path

- [ ] Click "Recover a bad render" (sends "Chart the Antigravity quarterly revenue board and repair a malformed first render.")
- [ ] Verify the agent calls `generate_a2ui` once and a valid surface paints (no broken surface, no error banner)
- [ ] Verify the painted surface shows two `declarative-metric` tiles: "Quarterly Revenue" $4.2M (+12% QoQ, up) and "Win Rate" 31% (-2 pts, down)
- [ ] Backend logs: verify one `[a2ui recovery] attempt …: invalid` line followed by one `… valid` line
- [ ] DevTools → Network: verify the tool result carries an `a2ui_operations` container (no `a2ui_recovery_exhausted`)
- [ ] Verify the chat reply is one short sentence noting the recovery (fixture: "The first render came back malformed - I recovered and painted your quarterly revenue board.")

### 3. Hard-fail (recovery exhausted) path

- [ ] Click "Show an unrecoverable failure" (sends "Chart an Antigravity board that never passes validation so I can preview the fallback.")
- [ ] Verify the result is a tidy failure card ("Couldn't generate the UI"), NOT a broken or half-rendered surface and NOT a silent drop
- [ ] Backend logs: verify three `[a2ui recovery] attempt …: invalid` lines and no valid one
- [ ] DevTools → Network: verify the tool result is an `a2ui_recovery_exhausted` envelope (no `a2ui_operations` painted)
- [ ] Verify the chat reply explains the fallback in one short sentence and the agent does not call `generate_a2ui` again

### 4. Regression / isolation

- [ ] Verify the recovery demo does not affect the declarative-gen-ui or beautiful-chat demos (separate routes and agents)
- [ ] Re-run each pill a second time in the same thread and verify the same outcome

### 5. Error Handling

- [ ] Send an empty message; verify it is a no-op
- [ ] DevTools → Console: verify no uncaught errors and no run left hanging on a frontend `render_a2ui` tool

## Expected Results

- Heal pill: one invalid attempt, then a valid two-metric surface painted within 60s
- Exhaust pill: three invalid attempts, then the recovery-exhausted failure card — never a broken surface
- Chat replies are one short sentence each
- No UI layout breaks, no uncaught console errors
