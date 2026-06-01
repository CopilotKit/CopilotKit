# QA: Sub-Agents — Agno

## Prerequisites

- Demo is deployed and accessible at `/demos/subagents` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set; the Agno agent server exposes the `/subagents/agui` endpoint

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/subagents`; verify the page renders within 3s with a left-side delegation log panel and a right-side `CopilotChat` pane
- [ ] Verify `data-testid="delegation-log"` is visible with heading "Sub-agent delegations"
- [ ] Verify the empty-state `data-testid="delegation-empty"` reads "No delegations yet. Ask the supervisor to plan a deliverable."
- [ ] Verify `data-testid="delegation-count"` reads "0 calls"
- [ ] Verify the chat input placeholder is "Give the supervisor a task..."
- [ ] Verify all 3 suggestion pills are visible with verbatim titles: "Write a blog post", "Explain a topic", "Summarize a topic"

### 2. Feature-Specific Checks

#### Live delegation log (research → write → critique)

- [ ] Click the "Write a blog post" suggestion (sends a request that asks for research → writing → critique on cold exposure training)
- [ ] Within 5s verify `data-testid="supervisor-running"` appears next to the heading (the supervisor's `agent.isRunning` is true)
- [ ] Within 30s verify at least 3 `data-testid="delegation-entry"` cards have appeared, in order: Research → Writing → Critique (matching the supervisor's instructed sequence)
- [ ] Verify each card shows a sub-agent badge (Research blue, Writing emerald, Critique purple) and a status badge that ends in `completed` (emerald) once the sub-agent returns
- [ ] During delegation, verify in-flight cards show `data-status="running"` with an amber border, an animated spinner, and the text "Sub-agent is working…"
- [ ] After the run finishes, verify each completed card shows a non-empty result body (research bullets, draft paragraph, critique bullets) — the agno custom AGUI router emits a `StateSnapshotEvent` carrying `delegations` after each run, so the UI re-renders the final state
- [ ] Verify `data-testid="delegation-count"` updates to reflect the total number of delegations made
- [ ] Verify the supervisor's final chat message returns a concise summary referencing the work done

#### Sub-agent variety

- [ ] Click "Explain a topic"; verify a fresh `Research` → `Writing` → `Critique` sequence appears (delegations from the prior run remain in the log; the supervisor instructs `set_notes`-style replacement only on the supervisor agent — sub-agent log is append-only)
- [ ] Click "Summarize a topic"; verify another sequence appears, growing the log

#### Failure handling

- [ ] (Best-effort, hard to provoke) If a sub-agent ever fails (network blip, provider error), verify the corresponding entry transitions to `data-status="failed"` with a red border and the body text reads `sub-agent call failed: <ExceptionClassName> (see server logs for details)` — no provider URLs / request IDs leaked to the UI

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op
- [ ] Reload the page; verify the delegation log resets to its empty state
- [ ] Verify DevTools -> Console shows no uncaught errors during any flow above

## Expected Results

- Page loads within 3 seconds
- First delegation entry appears within 10 seconds of a non-trivial task being submitted
- Full research → write → critique chain completes within 60 seconds for typical prompts
- Delegations list grows in real time, with `running` status visible while a sub-agent is working and `completed`/`failed` once it returns
- No UI layout breaks, no uncaught console errors
