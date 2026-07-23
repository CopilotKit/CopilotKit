# QA: Sub-Agents — PydanticAI

## Prerequisites

- Demo is deployed and accessible at `/demos/subagents` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set; the PydanticAI agent server is reachable on the configured `AGENT_URL` and the `/subagents` sub-path is mounted (supervisor + 3 sub-agents)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/subagents`; verify the page renders within 3s with a left-side delegation log panel and a right-side `CopilotChat` pane
- [ ] Verify `data-testid="delegation-log"` is visible with heading "Sub-agent delegations"
- [ ] Verify `data-testid="delegation-count"` reads `0 calls` initially
- [ ] Verify the empty state message "Ask the supervisor to complete a task. Every sub-agent it calls will appear here." is visible
- [ ] Verify the chat input placeholder is "Give the supervisor a task..."
- [ ] Verify all 3 suggestion pills are visible: "Write a blog post", "Explain a topic", "Summarize a topic"
- [ ] Send "Hello, what can you do?" and verify an assistant text response within 10s

### 2. Feature-Specific Checks

#### Supervisor Delegates to Sub-Agents

- [ ] Click the "Write a blog post" suggestion (the supervisor should delegate to research → writing → critique)
- [ ] Within 5s of the run starting, verify `data-testid="supervisor-running"` appears next to the heading
- [ ] Verify a `data-testid="delegation-entry"` for `Research` appears with the running task visible, then transitions from `running` to `completed` with a bulleted list of facts
- [ ] Verify a `Writing` entry appears next, transitioning from `running` to `completed` with a polished paragraph in the result
- [ ] Verify a `Critique` entry appears last, transitioning from `running` to `completed` with 2-3 actionable critiques
- [ ] Verify `data-testid="delegation-count"` reads `3 calls` after the full sequence completes
- [ ] Verify each entry's badge shows the correct sub-agent label and emoji (Research 🔎, Writing ✍️, Critique 🧐)

#### Live Updates

- [ ] While a delegation is in flight, verify the entry is visible with status `running` and the placeholder copy "Sub-agent is working..."
- [ ] Verify entries are appended in order (#1, #2, #3) as the supervisor calls each sub-agent

#### Multi-Turn Accumulation

- [ ] After the first task completes, send "Do another one — same topic but with a marketing angle."
- [ ] Verify new delegation entries are appended below the existing ones (the log grows; previous entries are preserved) and `delegation-count` increases accordingly

#### Supervisor-Running Indicator

- [ ] While the supervisor is producing its final summary, verify the running pill is still visible
- [ ] Verify it disappears once the supervisor finishes its turn

### 3. Error Handling

- [ ] Attempt to send an empty message; verify it is a no-op
- [ ] If a sub-agent fails (e.g. transient OpenAI error), verify the corresponding delegation entry shows status `failed` with the failure message in the result body, and the supervisor surfaces the failure to the user (no fabricated success)
- [ ] Verify DevTools -> Console shows no uncaught errors during any flow above

## Expected Results

- Page loads within 3 seconds
- First delegation entry appears within 5 seconds of submitting a multi-step task
- Each sub-agent completes within 30 seconds for short tasks
- The full research → write → critique chain runs and the log shows 3 entries, all `completed`
- Failed sub-agents render as `failed` (red) with a server-safe message; the supervisor does not pretend the work succeeded
- No UI layout breaks, no uncaught console errors
