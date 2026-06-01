# QA: Sub-Agents — AG2

## Prerequisites

- Demo is deployed and accessible at `/demos/subagents`
- Agent backend is healthy (check `/api/copilotkit` GET → `agent_status: reachable`)
- Backend has `OPENAI_API_KEY` set
- The `subagents` supervisor is mounted at `/subagents` on the FastAPI
  server (see `src/agent_server.py`)

## Test Steps

### 1. Page renders with delegation log + chat

- [ ] Navigate to `/demos/subagents`
- [ ] Left pane shows the **Delegation log** panel
      (`data-testid="delegation-log"`)
- [ ] Header reads "Sub-agent delegations" with a counter
      `data-testid="delegation-count"` showing `0 calls`
- [ ] Empty-state copy: "Ask the supervisor to complete a task. Every
      sub-agent it calls will appear here."
- [ ] Right pane shows the chat with placeholder
      "Give the supervisor a task..."

### 2. Single delegation chain

- [ ] Click suggestion **"Write a blog post"** (or send the equivalent
      message).
- [ ] While the supervisor runs, the badge
      `data-testid="supervisor-running"` ("Supervisor running") appears in
      the header.
- [ ] As the supervisor delegates, entries appear in the log
      (`data-testid="delegation-entry"`). Expect at least 3 entries — one
      `Research`, one `Writing`, one `Critique` — in that order.
- [ ] Each entry shows:
  - A `#N` index, a colored badge with the sub-agent name + emoji.
  - A `Task: ...` line summarizing what was delegated.
  - A `result` block containing the sub-agent's output (real LLM text,
    not placeholders).
- [ ] Counter updates to `3 calls` (or more if the supervisor iterated).

### 3. Independent delegations

- [ ] Reload the page (state resets).
- [ ] Send: **"Research what causes the northern lights."**
- [ ] At least 1 `Research` delegation appears with a bulleted list of
      facts in the result.
- [ ] Send: **"Now write a paragraph aimed at a 10-year-old, using those
      facts."**
- [ ] A `Writing` delegation appears with a polished paragraph in the
      result.
- [ ] Send: **"Critique that paragraph."**
- [ ] A `Critique` delegation appears with 2-3 actionable critiques.

### 4. Supervisor reply hygiene

- [ ] After each chain, the supervisor's chat reply is short — it
      summarizes rather than re-pasting the full sub-agent output (which
      already lives in the delegation log).
- [ ] The "Supervisor running" badge disappears once the run is complete.

### 5. Error handling

- [ ] Send a very short message (e.g. "Hi"). The supervisor responds
      gracefully (it may not delegate for a trivial greeting).
- [ ] No console errors during normal usage.

## Expected Results

- Page loads in < 3 seconds.
- Each user request that's non-trivial produces at least one delegation
  entry.
- The delegation log grows live during the run, not just at the end.
- Sub-agent results are real LLM outputs (not stubbed strings).
