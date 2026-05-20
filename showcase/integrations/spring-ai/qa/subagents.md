# QA: Sub-Agents — Spring AI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check `/api/health`)
- `OPENAI_API_KEY` is set on the Spring backend

## Architecture under test

- Spring's `SubagentsController` runs a per-request supervisor agent that
  exposes three tools — `research_agent`, `writing_agent`, `critique_agent`
  — each backed by its own `ChatClient` call with a dedicated system
  prompt (research vs. writing vs. critique).
- Every tool invocation appends a `Delegation` entry
  `{ id, sub_agent, task, status, result }` to `state.delegations` and
  emits a `STATE_SNAPSHOT` event, so the UI's live "delegation log"
  panel grows entry-by-entry while the supervisor works.

## Test Steps

### 1. Page load

- [ ] Navigate to `/demos/subagents`.
- [ ] Verify the delegation log card renders
      (`data-testid="delegation-log"`).
- [ ] Verify it shows the empty-state message
      ("Ask the supervisor to complete a task...").
- [ ] Verify `data-testid="delegation-count"` reads "0 calls".
- [ ] Verify the chat panel is visible on the right with the
      "Give the supervisor a task..." placeholder.

### 2. Single delegation

- [ ] Send: "Research the basics of magnesium supplementation. Just one
      delegation, no writing or critique."
- [ ] While the supervisor is running, verify
      `data-testid="supervisor-running"` is visible.
- [ ] Verify exactly one `data-testid="delegation-entry"` appears with
      sub-agent label "Research" and status "completed".
- [ ] Verify `data-testid="delegation-count"` reads "1 calls".

### 3. Full pipeline

- [ ] Click the "Write a blog post" suggestion (or send the equivalent
      message manually).
- [ ] Watch the delegation log grow in real time:
  - [ ] First entry: Research (sub_agent = `research_agent`)
  - [ ] Second entry: Writing (sub_agent = `writing_agent`) — should
        contain a polished one-paragraph draft.
  - [ ] Third entry: Critique (sub_agent = `critique_agent`) — should
        contain 2–3 actionable critiques.
- [ ] Verify each entry's "Task" line shows what the supervisor passed
      to that sub-agent.
- [ ] Verify final supervisor message is concise (a short summary, not a
      replay of all three sub-agent outputs).

### 4. Live snapshot ordering

- [ ] Verify the entries appear incrementally — the writing entry should
      not show up at the same time as the research entry; if it does, the
      backend is batching state snapshots.

### 5. Multi-turn

- [ ] After the pipeline completes, send: "Now do the same for the
      benefits of cold exposure training."
- [ ] Verify three more entries are appended (count = 6).
- [ ] Verify older entries remain visible (delegation log is append-only
      within a thread).

### 6. Error handling

- [ ] Send an empty message — UI should handle gracefully.
- [ ] If a sub-agent fails (transient OpenAI error), verify the entry's
      `status` field reads "failed" and its result starts with
      "Sub-agent failed:".
- [ ] No console errors during normal usage.

## Expected Results

- Page loads within 3 seconds.
- First delegation entry appears within 10 seconds of sending the
  message; subsequent entries appear as each sub-agent ChatClient call
  completes.
- "Supervisor running" indicator clears as soon as the run finishes.
- Final delegation count matches the number of sub-agent calls the
  supervisor made (typically 1 or 3).
- No UI errors, no broken layout, no overlap between log and chat panes.
