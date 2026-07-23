# QA: Sub-Agents — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/subagents` on the dashboard host
- Agent backend is healthy (`/api/health`); `ANTHROPIC_API_KEY` is set on Railway; the FastAPI backend exposes `POST /subagents`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/subagents`; verify the page renders within 3s with a left-side delegation log and a right-side `CopilotChat` pane
- [ ] Verify `data-testid="delegation-log"` is visible with heading "Sub-agent delegations"
- [ ] Verify `data-testid="delegation-count"` reads "0 calls" on first load
- [ ] Verify the empty-state placeholder reads "Ask the supervisor to complete a task. Every sub-agent it calls will appear here."
- [ ] Verify the chat input placeholder is "Give the supervisor a task..."
- [ ] Verify all 3 suggestion pills are visible with verbatim titles: "Write a blog post", "Explain a topic", "Summarize a topic"

### 2. Feature-Specific Checks

#### Multi-stage Delegation Flow

- [ ] Click the "Write a blog post" suggestion (cold-exposure training prompt)
- [ ] Within 5s verify `data-testid="supervisor-running"` appears with the "Supervisor running" pulse indicator
- [ ] Within 30s verify at least one `data-testid="delegation-entry"` appears with badge "Research" and `data-testid="delegation-status"` initially reading `running`
- [ ] Verify the entry's status flips to `completed` once the sub-agent returns and the `result` text is visible inside the entry's white inner panel
- [ ] Within 60s total verify additional delegation entries appear in order: Research -> Writing -> Critique (3 entries total in most cases)
- [ ] Verify `data-testid="delegation-count"` updates to match the number of entries (e.g. "3 calls")
- [ ] Verify the supervisor's final chat reply includes a brief summary of the produced deliverable

#### Delegation Entry Layout

- [ ] Each `data-testid="delegation-entry"` shows: a `#N` index, a sub-agent badge with the correct emoji (🔎 Research / ✍️ Writing / 🧐 Critique), a status chip, the task text after "Task:", and the sub-agent's result rendered with whitespace preserved
- [ ] Hover the supervisor running chip while a delegation is in flight — verify the pulse animation is present (no static-only state)

#### Sub-Agent Independence

- [ ] Click "Explain a topic" (LLM tool calling prompt) and wait for completion
- [ ] Verify the writing entry's `result` is a single polished paragraph (the writing sub-agent's signature)
- [ ] Verify the research entry's `result` is a bulleted list of 3-5 facts (the research sub-agent's signature)
- [ ] Verify the critique entry's `result` contains 2-3 actionable critiques

#### Supervisor State Reset Across Tasks

- [ ] After the first run completes, click "Summarize a topic" (reusable rockets)
- [ ] Verify NEW delegation entries are appended to the existing list (count keeps growing) — confirms `state["delegations"]` accumulates across turns within the same thread

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op
- [ ] If a sub-agent call fails (e.g. due to upstream rate limit), verify the failing entry is rendered with status `failed` and a result line starting with "sub-agent call failed:" — confirms the fail-loud path
- [ ] Verify DevTools -> Console shows no uncaught errors during any flow above

## Expected Results

- Page loads within 3 seconds
- First delegation entry appears within 30 seconds of submitting a non-trivial task
- Each delegation entry transitions from `running` -> `completed` (or `failed`) and the count badge stays in sync with `state["delegations"].length`
- Supervisor's final chat reply summarises the work and arrives within 90 seconds of submission
- No UI layout breaks, no uncaught console errors
