# QA: Sub-Agents — LangGraph (FastAPI)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check `/api/copilotkit` GET — `agent_status: "reachable"`)
- `OPENAI_API_KEY` is set in the agent environment

## What this demo proves

- A supervisor LLM exposes three sub-agents (`research_agent`,
  `writing_agent`, `critique_agent`) as tools.
- Each sub-agent is a real `create_agent(...)` with its own system
  prompt — the supervisor does NOT just template-fill responses.
- Every delegation appends an entry to the `delegations` slot of agent
  state, which the UI renders live as a delegation log.

## Test Steps

### 1. Page loads with delegation log + chat

- [ ] Navigate to `/demos/subagents`
- [ ] The delegation log (`data-testid="delegation-log"`) is visible on the left
- [ ] Header reads "Sub-agent delegations"
- [ ] Counter (`data-testid="delegation-count"`) reads "0 calls"
- [ ] Empty state copy: "Ask the supervisor to complete a task..."
- [ ] Chat is visible on the right with placeholder "Give the supervisor a task..."

### 2. Supervisor running indicator

- [ ] Send the "Write a blog post" suggestion
- [ ] Within ~2 seconds the `supervisor-running` badge appears on the log header
- [ ] The badge has the pulsing dot and "Supervisor running" label

### 3. Delegations appear live

- [ ] As the run progresses, `delegation-entry` rows appear one at a time
- [ ] Counter increments accordingly (1 calls, 2 calls, 3 calls)
- [ ] Typical sequence on the "Write a blog post" suggestion:
  - [ ] First entry shows the Research badge (`🔎 Research`)
  - [ ] Second entry shows the Writing badge (`✍️ Writing`)
  - [ ] Third entry shows the Critique badge (`🧐 Critique`)
- [ ] Each entry shows the task on one line and the sub-agent's result
      below it in the result panel
- [ ] Each entry status shows `completed`

### 4. Result quality (sanity check)

- [ ] The research entry's result is a bulleted list of 3-5 facts
- [ ] The writing entry's result is a single coherent paragraph
- [ ] The critique entry's result is 2-3 bullet/critique items
- [ ] When the supervisor finishes, the `supervisor-running` badge disappears

### 5. Multiple runs accumulate

- [ ] Send the "Explain a topic" suggestion next
- [ ] Counter continues from previous total (does not reset)
- [ ] New delegation entries are appended at the bottom

### 6. Error handling

- [ ] Sending an empty message is handled gracefully (no crash)
- [ ] No console errors during a normal run

## Expected Results

- Chat loads within 3 seconds
- First delegation appears within ~10 seconds of sending a task
- A typical 3-step plan completes in under 60 seconds
- No UI errors, broken layouts, or console warnings
