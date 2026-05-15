# QA: Sub-Agents — LlamaIndex

## Prerequisites

- Demo is deployed and accessible at `/demos/subagents` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set; LlamaIndex agent_server has the `subagents_router` mounted at `/subagents`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/subagents`; verify the page renders within 3s with a left-side delegation log and a right-side `CopilotChat` pane
- [ ] Verify `data-testid="delegation-log"` is visible with heading "Sub-agent delegations"
- [ ] Verify `data-testid="delegation-count"` shows "0 calls" before any interaction
- [ ] Verify the empty-state copy reads "Ask the supervisor to complete a task. Every sub-agent it calls will appear here."
- [ ] Verify the chat input placeholder is "Give the supervisor a task..."
- [ ] Verify all 3 suggestion pills are visible with verbatim titles: "Write a blog post", "Explain a topic", "Summarize a topic"

### 2. Feature-Specific Checks

#### Multi-Step Delegation (research -> writing -> critique)

- [ ] Click the "Write a blog post" suggestion; verify the supervisor running indicator (`data-testid="supervisor-running"`) appears within 2s and shows "Supervisor running"
- [ ] Within 60s, verify three `data-testid="delegation-entry"` rows appear in order with `data-status="completed"` and these badges (in order):
  - Research (blue badge)
  - Writing (emerald badge)
  - Critique (purple badge)
- [ ] Verify `data-testid="delegation-count"` reads "3 calls"
- [ ] Verify each entry shows a "Task:" line and an output box; the research output is a bulleted list of facts, the writing output is a paragraph, and the critique output is 2-3 bullet critiques
- [ ] Verify the supervisor's final chat message in the right-side pane summarizes the result (1-3 sentences)
- [ ] After the run completes verify the running indicator is hidden

#### Live "running" State

- [ ] Send "Write a short blog post about AI agents. Research first, then write."; while the supervisor is in flight, verify at least one entry briefly shows `data-status="running"` with the spinner and "Sub-agent is working…" copy before flipping to `completed`

#### Status Coloring & Ordering

- [ ] Click the "Explain a topic" suggestion; verify entries appear top-down in invocation order (research first, writing second, critique last)
- [ ] Verify `running` entries use amber styling, `completed` entries use neutral styling, and any `failed` entries use red styling

#### Multi-Turn Accumulation

- [ ] After one full delegation run, send "Now do the same for cold plunges"; verify the delegation log grows (previous entries preserved, 3 new entries appended) and `delegation-count` reads "6 calls"
- [ ] Reload the page; verify the delegation log resets to empty (state is per-session)

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op (no user bubble, no assistant response, no new delegation entries)
- [ ] If a sub-agent invocation fails (e.g. transient OpenAI 5xx), verify the corresponding entry shows `data-status="failed"` with red styling and a `[sub-agent failed]` message; verify the supervisor's chat reply briefly surfaces the failure rather than fabricating a result
- [ ] Verify DevTools -> Console shows no uncaught errors during any flow above

## Expected Results

- Page loads within 3 seconds
- A typical research/write/critique sequence completes within 60 seconds
- The delegation log updates live as each sub-agent finalizes (entries flip from running to completed/failed)
- The supervisor running indicator reflects `agent.isRunning`
- Delegation entries persist across multi-turn runs within a session and reset on reload
- No UI layout breaks, no uncaught console errors
