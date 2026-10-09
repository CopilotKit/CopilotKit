# QA: A2UI Error Recovery — AWS Strands (TypeScript)

## Prerequisites

- Demo is deployed and accessible at `/demos/a2ui-recovery` on the dashboard host
- Agent backend is healthy; `OPENAI_API_KEY` is set; `AGENT_URL` points at the Strands (TS) agent server; the recovery agent is mounted at `AGENT_URL/a2ui-recovery/` (registered as agent name `a2ui-recovery` — see `src/app/api/copilotkit-a2ui-recovery/route.ts` and `src/agent/server.ts`)
- Requires `@ag-ui/aws-strands` with A2UI recovery (the validate→retry loop + `a2ui_recovery_exhausted` hard-fail envelope run on the adapter's auto-inject path) and the `@copilotkit` A2UI renderer (the `building`/`retrying`/`failed` lifecycle rendering)
- Wiring: the page's provider catalog auto-enables A2UI tool injection; the Strands adapter auto-injects `generate_a2ui`, drives the `render_a2ui` planner, and runs the recovery loop itself (no explicit backend tool, unlike the langgraph/ADK siblings — see `buildA2uiRecoveryAgent` in `src/agent/agent.ts`)
- Reuses the **declarative-gen-ui** catalog (`catalogId: "declarative-gen-ui-catalog"`) and the Vantage Threads sales context — no new components

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
- [ ] Verify the **painted** surface is valid: a `declarative-metric` row ("Quarterly Revenue $4.2M", "Win Rate 31%")
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

## Notes

- The malformed renders are forced by aimock fixtures (`showcase/aimock/d6/strands-typescript/a2ui-recovery.json`): the inner `render_a2ui` call is matched by `userMessage` + `toolName=render_a2ui`. Healing itself is performed live by the toolkit recovery loop inside the Strands adapter.
- AWS-Strands-TypeScript sibling of the langgraph-python `a2ui-recovery` demo. On Strands the recovery loop runs on the adapter's auto-inject path, so no explicit `getA2UITools` wiring is needed.
