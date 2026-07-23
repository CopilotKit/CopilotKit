# QA: Sub-Agents — AWS Strands

## Prerequisites

- Demo is deployed and accessible at `/demos/subagents` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set; the Strands agent server (`agent_server.py`) is reachable at `AGENT_URL`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/subagents`; verify the page renders within 3s with a wide delegation log on the left and a `CopilotChat` pane on the right
- [ ] Verify `data-testid="delegation-log"` is visible with heading "Sub-agent delegations"
- [ ] Verify the empty state reads "Ask the supervisor to complete a task. Every sub-agent it calls will appear here."
- [ ] Verify `data-testid="delegation-count"` reads "0 calls"
- [ ] Verify the chat input placeholder is "Give the supervisor a task..."
- [ ] Verify all 3 suggestion pills are visible: "Write a blog post", "Explain a topic", "Summarize a topic"

### 2. Feature-Specific Checks

#### Supervisor delegates to sub-agents (research → write → critique)

- [ ] Click the "Write a blog post" suggestion (sends a research/write/critique sequence prompt)
- [ ] Within 5s verify `data-testid="supervisor-running"` appears next to the heading with the pulsing indicator
- [ ] Within 60s verify `data-testid="delegation-count"` reads at least "3 calls" and at least 3 `data-testid="delegation-entry"` rows are rendered
- [ ] Verify the first entry has the `🔎 Research` badge, a non-empty `Task:` line, and a result body containing 3-5 bullet points
- [ ] Verify a subsequent entry has the `✍️ Writing` badge with a polished paragraph in the result body
- [ ] Verify a subsequent entry has the `🧐 Critique` badge with 2-3 actionable critiques
- [ ] Verify each entry shows status `completed` (green) once the sub-agent has returned
- [ ] Once the supervisor returns a final assistant text message, verify `supervisor-running` disappears

#### Live updates during the run

- [ ] Click the "Explain a topic" suggestion
- [ ] Verify entries appear ONE-AT-A-TIME (the count climbs from 0 → 1 → 2 → 3 over multiple seconds rather than all appearing at once) — this confirms each sub-agent's `state_from_result` hook emits an independent `StateSnapshotEvent`
- [ ] Verify entry numbers (`#1`, `#2`, `#3`) are sequential and stable

#### Multi-turn persistence

- [ ] After the first run completes, send "Now do the same for solar panels." — verify the delegation log GROWS (existing rows kept; new rows appended); the count should continue from where it left off (e.g. "3 calls" → "6 calls")

### 3. Error Handling

- [ ] Send an empty message — verify it is a no-op
- [ ] Send "Hello" (no task to delegate); verify the supervisor responds with a short text reply and NO new delegation entries are added
- [ ] Verify DevTools -> Console shows no uncaught errors during any flow above

## Expected Results

- Page loads within 3 seconds
- First delegation entry appears within 15s of submitting a task; full research → write → critique loop completes within 60s
- Each sub-agent invocation produces exactly one delegation entry with a non-empty `task` and `result`
- Supervisor's final summary references the work that was delegated
- No UI layout breaks, no uncaught console errors
