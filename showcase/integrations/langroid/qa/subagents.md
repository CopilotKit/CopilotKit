# QA: Sub-Agents — Langroid

## Prerequisites

- Demo is deployed and accessible at `/demos/subagents` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set on Railway; the FastAPI agent server exposes `POST /subagents` (see `src/agent_server.py`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/subagents`; verify the page renders within 3s with the delegation log on the left and the `CopilotChat` pane on the right
- [ ] Verify `data-testid="delegation-log"` is visible with header "Sub-agent delegations"
- [ ] Verify `data-testid="delegation-count"` shows `0 calls`
- [ ] Verify the empty-state copy "Ask the supervisor to complete a task. Every sub-agent it calls will appear here." is rendered
- [ ] Verify the chat input placeholder is "Give the supervisor a task..."
- [ ] Verify all 3 suggestion pills are visible with verbatim titles: "Write a blog post", "Explain a topic", "Summarize a topic"

### 2. Feature-Specific Checks

#### Live delegation log (running -> completed)

- [ ] Click the "Write a blog post" suggestion (sends a multi-step request that should trigger research -> write -> critique)
- [ ] Within 5s verify `data-testid="supervisor-running"` ("Supervisor running" pill) appears in the log header
- [ ] Within 10s verify the first `data-testid="delegation-entry"` appears with the Research badge (`🔎 Research`) and `running` status; the result body should show "Sub-agent running…"
- [ ] Within 30s verify the entry flips to `completed` status and a bulleted list of facts is rendered in the result body
- [ ] Verify a second `data-testid="delegation-entry"` appears with the Writing badge (`✍️ Writing`), goes through `running` -> `completed`, and renders a 1-paragraph draft
- [ ] Verify a third `data-testid="delegation-entry"` appears with the Critique badge (`🧐 Critique`) and renders 2-3 critiques
- [ ] Verify `data-testid="delegation-count"` updates to `3 calls` (or more if the supervisor delegates again)
- [ ] After the run finishes, verify `data-testid="supervisor-running"` is no longer rendered and the chat receives a brief final summary

#### Sequential chaining

- [ ] Send "Explain how large language models handle tool calling. Research, write a paragraph, then critique."
- [ ] Verify the delegations appear in order: Research, then Writing, then Critique (the supervisor passes the prior step's output through `task`)
- [ ] Verify each entry's `Task:` line references the user's topic and (for Writing/Critique) cites the prior step

#### Multi-message persistence

- [ ] After a completed run, send another task ("Summarize a topic …")
- [ ] Verify NEW delegation entries are appended to the log (existing entries from the prior turn remain visible, count grows)
- [ ] Reload the page; verify the delegation log resets to empty and `data-testid="delegation-count"` shows `0 calls`

### 3. Error Handling

- [ ] Send a trivially-conversational message like "Hi"; verify the supervisor either responds in plain text without delegating (count stays at `0 calls`) or delegates only once and finishes — no infinite loop
- [ ] Verify DevTools -> Console shows no uncaught errors during any flow above
- [ ] If the secondary LLM fails (e.g. quota exhausted), verify a `failed` delegation entry is rendered with red status and a brief error message in the result body — the supervisor still produces a final user-facing message

## Expected Results

- Page loads within 3 seconds
- Each delegation transitions from `running` to `completed` (or `failed`) within ~30s
- Delegation log entries appear in submission order and preserve across multiple supervisor turns within a single run
- The supervisor returns a final natural-language summary after the last sub-agent completes
- No UI layout breaks, no uncaught console errors
