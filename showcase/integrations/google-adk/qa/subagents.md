# QA: Sub-Agents — Google ADK

## Prerequisites

- Demo is deployed and accessible at `/demos/subagents` on the dashboard host
- Agent backend is healthy (`/api/health`); `GOOGLE_API_KEY` is set (or `GOOGLE_GEMINI_BASE_URL` points at the aimock proxy)
- A supervisor `LlmAgent` delegates to three sub-agents (research / writing / critique) via tools. Each delegation appends one `completed` entry to `state["delegations"]`.

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/subagents`; verify the page renders within 3s with the "Sub-agent delegations" panel on the left and the `CopilotChat` on the right
- [ ] Verify the delegation panel header reads "Sub-agent delegations" with a `0 calls` counter on initial load
- [ ] Verify the three sub-agent role indicator chips render at the top of the panel — Researcher, Writer, Critic — with dimmed (un-fired) styling
- [ ] Verify the empty-state hint reads "Ask the supervisor to complete a task. Every sub-agent it calls will appear here."
- [ ] Verify the chat input placeholder reads "Give the supervisor a task..."
- [ ] Send "Hello" and verify the agent responds within 10s

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify all 3 suggestion pills are visible with verbatim titles:
  - "Write a blog post"
  - "Explain a topic"
  - "Summarize a topic"

#### Multi-Agent Delegation (Research → Writing → Critique)

- [ ] Click "Write a blog post"
- [ ] Within 60s verify the chat stream renders 3 inline activity cards in sequence:
  - `data-testid="subagent-card-researcher"` — Researcher activity card
  - `data-testid="subagent-card-writer"` — Writer activity card
  - `data-testid="subagent-card-critic"` — Critic activity card
- [ ] Verify each card walks through statuses: starting → running → done (each card surfaces `data-status="complete"` once finished)
- [ ] Verify each card's `data-testid="subagent-result"` contains real generated text (not "(empty)" and not the showcase intro boilerplate)
- [ ] Verify the side-panel "Sub-agent delegations" list shows 3 `delegation-entry` cards (one per sub-agent), each labeled Research / Writing / Critique with the corresponding task
- [ ] Verify the `Supervisor running` badge appears next to the header while the supervisor is active and disappears once it finishes

#### Active-Subagent Banner

- [ ] During a delegation run, verify the sticky "active subagent" banner (`data-testid="active-subagent-banner"`) appears at the top of the chat panel and names whichever sub-agent is currently running
- [ ] Verify the banner disappears once the supervisor completes

#### Critic Loop Regression (one critic card per run)

- [ ] Confirm that exactly 1 critic card renders per pill click — the count must be stable across a 5s dwell after completion
- [ ] If a second critic card appears, the supervisor is re-entering the critic — file a bug (see `subagents_agent.py` instruction enforcing single-call-per-tool)

#### All Pills Run the Same Flow

- [ ] Click "Explain a topic" — verify the same 3-card / 3-delegation pattern
- [ ] Click "Summarize a topic" — verify the same 3-card / 3-delegation pattern

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op
- [ ] If a Gemini sub-agent call fails, verify the delegation log shows the error as a `completed` entry whose `result` contains the user-facing failure message (server logs preserve the traceback)
- [ ] Verify no uncaught console errors during normal usage

## Expected Results

- Chat loads within 3 seconds; first delegation card appears within 60 seconds
- Each of the 3 sub-agents fires exactly once per pill click
- Card results are real generated text, not boilerplate
- Side panel and inline chat stay synchronized via `state["delegations"]`
- No console errors, no stuck-state, no critic-loop regression
