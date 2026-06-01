# QA: Sub-Agents — MS Agent Framework (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/subagents` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set on Railway; the agent server has the `subagents` supervisor mounted at `/subagents`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/subagents`; verify the page renders within 3s with the delegation log on the left and the `CopilotChat` pane on the right
- [ ] Verify `data-testid="delegation-log"` is visible with heading "Sub-agent delegations"
- [ ] Verify `data-testid="delegation-count"` shows "0 calls" on first render
- [ ] Verify the empty-state copy "Ask the supervisor to complete a task. Every sub-agent it calls will appear here." is visible
- [ ] Verify the chat input placeholder is "Give the supervisor a task..."
- [ ] Verify all 3 suggestion pills are visible with verbatim titles: "Write a blog post", "Explain a topic", "Summarize a topic"

### 2. Feature-Specific Checks

#### Single Delegation — Research

- [ ] Send "Give me 3 facts about reusable rockets."
- [ ] Within 15s verify at least one `data-testid="delegation-entry"` appears
- [ ] Verify the entry's badge reads "Research" (research_agent)
- [ ] Verify `data-testid="delegation-count"` reads "1 calls" (or higher)
- [ ] Verify the `Task: ...` line shows the research brief and the body contains a bulleted list of facts

#### Full Pipeline — Research -> Write -> Critique

- [ ] Click the "Write a blog post" suggestion (sends a brief about cold exposure training)
- [ ] Within 30s verify the delegation log contains at least 3 entries: one Research, one Writing, one Critique (in that order)
- [ ] Verify each entry's `status` reads "completed"
- [ ] Verify the supervisor's chat reply summarises the work in 1-2 sentences (it should NOT dump the full draft inline; the draft lives in the log)

#### Live Updates While Running

- [ ] Send "Explain how LLMs do tool calling. Research, write a paragraph, then critique."
- [ ] While the supervisor is running, verify `data-testid="supervisor-running"` badge ("Supervisor running") appears next to the title
- [ ] Watch the delegation log: verify entries arrive incrementally as each sub-agent finishes (NOT all at once at the end) — confirms `state_update(...)` is emitted as a `StateSnapshotEvent` per tool call
- [ ] After the supervisor finishes, verify the running badge disappears

#### Multiple Turns

- [ ] Send a second prompt "Summarize the current state of reusable rockets in 1 polished paragraph, with research and critique."
- [ ] Verify the delegation log GROWS — prior entries are preserved and new ones append (no clobber). Confirms each delegation tool reads the prior list out of the agent's `current_state`-driven contextvar before pushing.

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op
- [ ] Send "Hello" (no delegation needed); verify the supervisor replies without delegating, and the delegation log stays empty
- [ ] Verify DevTools -> Console shows no uncaught errors during any flow above

## Expected Results

- Page loads within 3 seconds
- Single research-only prompts complete within 15 seconds
- Full research -> write -> critique pipelines complete within 30 seconds
- Delegation entries arrive incrementally and persist across turns
- No UI layout breaks, no uncaught console errors
