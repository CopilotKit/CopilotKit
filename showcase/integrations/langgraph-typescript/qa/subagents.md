# QA: Sub-Agents — LangGraph (TypeScript)

## Prerequisites

- Demo is deployed and accessible at `/demos/subagents` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set on Railway; `LANGGRAPH_DEPLOYMENT_URL` points at a LangGraph deployment exposing the `subagents` graph

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/subagents`; verify the page renders within 3s with the delegation log on the left and the chat pane on the right
- [ ] Verify `data-testid="delegation-log"` is visible with heading "Sub-agent delegations"
- [ ] Verify `data-testid="delegation-count"` shows "0 calls" on first load
- [ ] Verify the empty-state message "Ask the supervisor to complete a task. Every sub-agent it calls will appear here." is visible
- [ ] Verify the chat input placeholder is "Give the supervisor a task..."
- [ ] Verify all 3 suggestion pills are visible with verbatim titles: "Write a blog post", "Explain a topic", "Summarize a topic"
- [ ] Send "Hello" and verify the supervisor responds with a short text message within 10s (no delegations needed for a greeting)

### 2. Feature-Specific Checks

#### Sequential Delegation (research -> write -> critique)

- [ ] Click the "Write a blog post" suggestion (sends a request that explicitly asks for research, write, then critique)
- [ ] While the supervisor is running, verify `data-testid="supervisor-running"` chip appears in the log header reading "Supervisor running"
- [ ] Within 60s verify `data-testid="delegation-entry"` items appear in order — at least 3 entries
- [ ] Verify the first entry is tagged "Research" (`research_agent`) with a bulleted list of facts in its result
- [ ] Verify the second entry is tagged "Writing" (`writing_agent`) with a polished paragraph in its result
- [ ] Verify the third entry is tagged "Critique" (`critique_agent`) with 2-3 actionable critiques in its result
- [ ] Verify each entry shows status "completed"
- [ ] Verify `data-testid="delegation-count"` is "3 calls" (or more if the supervisor delegated additional rounds)
- [ ] Verify the supervisor returns a final summary in the chat after all delegations complete
- [ ] Verify `data-testid="supervisor-running"` is no longer rendered after the run finishes

#### Single Sub-Agent Invocation

- [ ] Click the "Explain a topic" suggestion
- [ ] Verify at least one `delegation-entry` appears with each step labeled correctly (Research / Writing / Critique)
- [ ] Verify each entry's `task` field is non-empty (the supervisor passes a real brief through the `task` argument)

#### Live Log Updates

- [ ] Send "Summarize the current state of reusable rockets in 1 polished paragraph, with research and critique."
- [ ] Verify entries appear progressively in the log (not all at once at the very end) — the log reflects state mutations as each sub-agent's tool returns
- [ ] Verify the chronological order in the log matches the order of supervisor tool calls

### 3. Error Handling

- [ ] Attempt to send an empty message; verify it is a no-op (no user bubble, no supervisor response)
- [ ] Send a trivial greeting ("Hi"); verify the supervisor replies without delegating (delegation count stays the same)
- [ ] Verify DevTools -> Console shows no uncaught errors during any flow above

## Expected Results

- Page loads within 3 seconds
- Supervisor responses (without delegation) within 10 seconds
- Full research -> write -> critique cycle completes within 60 seconds
- Each delegation entry includes the sub-agent label, task brief, and the sub-agent's full result text
- Live log updates as each sub-agent finishes (not after the entire supervisor run)
- No UI layout breaks, no uncaught console errors
