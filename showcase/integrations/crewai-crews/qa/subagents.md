# QA: Sub-Agents — CrewAI (Crews)

## Prerequisites

- Demo is deployed and accessible at `/demos/subagents` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set; the FastAPI agent server has the `/subagents` Flow endpoint mounted (see `src/agent_server.py`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/subagents`; verify the page renders within 3s with the left-side delegation log panel and right-side `CopilotChat` pane
- [ ] Verify `data-testid="delegation-log"` is visible with heading "Sub-agent delegations"
- [ ] Verify `data-testid="delegation-count"` reads "0 calls" before any task is sent
- [ ] Verify the empty-state copy "Ask the supervisor to complete a task. Every sub-crew it kicks off will appear here." is visible
- [ ] Verify the chat input placeholder is "Give the supervisor a task..."
- [ ] Verify all 3 suggestion pills are visible: "Write a blog post", "Explain a topic", "Summarize a topic"

### 2. Feature-Specific Checks

#### Supervisor Delegates to Sub-Crews

- [ ] Click the "Write a blog post" suggestion (sends a message asking for a short blog post about cold exposure with research → write → critique)
- [ ] Within ~3s verify `data-testid="supervisor-running"` ("Supervisor running" pulsing badge) appears in the header while the run is in progress
- [ ] Within 60s verify three `data-testid="delegation-entry"` rows appear in order:
  1. A "Research" badge (purple, 🔎) with `data-testid="delegation-status"` reading `completed` and the result body containing 3-5 bullets prefixed with `- `
  2. A "Writing" badge (green, ✍️) with status `completed` and a single-paragraph result
  3. A "Critique" badge (orange, 🧐) with status `completed` and 2-3 bullet-point critiques
- [ ] Verify `data-testid="delegation-count"` reads "3 calls" (or the matching number) at the end of the run
- [ ] Verify the supervisor's final assistant message in the chat is short and references that the work is done (it is told to keep its own messages short)

#### Live Status Transitions

- [ ] Click the "Explain a topic" suggestion
- [ ] Watch a delegation entry first appear with status `running` (its result body shows "Sub-agent running...") before transitioning to `completed` once the sub-crew kickoff returns — confirms the flow emits a STATE_SNAPSHOT both before and after each `Crew.kickoff(...)` call
- [ ] Verify the `data-testid="supervisor-running"` badge disappears once the run finishes

#### Multiple Tasks in One Session

- [ ] After the first run completes, send "Now do the same for solar power adoption."
- [ ] Verify the delegations list is reset for the new turn (the flow's `supervise()` step clears `state.delegations` at the top of each turn) and grows again as the new sub-agents are called
- [ ] Verify each sub-agent's result body is non-empty and corresponds to its role (research is bullets, writing is a paragraph, critique is bullets)

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op (no user bubble, no supervisor invocation)
- [ ] Send a deliberately ambiguous message like "Hi"; verify the supervisor either responds directly without delegating (delegation count stays at 0) or kicks off at most one sub-crew — both are acceptable, but the chat must produce a final assistant message and no entries should be stuck in `running` after the run finishes
- [ ] Verify DevTools -> Console shows no uncaught errors during any of the above

## Expected Results

- Page loads within 3 seconds
- A typical research → write → critique run completes within ~60 seconds with 3 delegation entries, all `completed`
- Each delegation entry transitions through `running` → `completed` (or `failed` if a sub-crew errors) and never gets stuck in `running` after the supervisor has finished
- The delegation log resets at the start of every fresh user turn
- No UI layout breaks, no uncaught console errors
