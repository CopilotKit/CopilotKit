# QA: Sub-Agents — Mastra

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the subagents demo page.
- [ ] Verify the delegation log card loads
      (`data-testid="delegation-log"`).
- [ ] Verify the empty-state message renders:
      "Ask the supervisor to complete a task. Every sub-agent it calls
      will appear here."
- [ ] Verify the delegation count (`data-testid="delegation-count"`)
      reads "0 calls".
- [ ] Verify the chat panel input placeholder is "Give the supervisor
      a task...".

### 2. Sub-agent delegation flow

- [ ] Click the "Write a blog post" suggestion. The supervisor should
      run a research -> write -> critique sequence.
- [ ] Verify a "Supervisor running"
      (`data-testid="supervisor-running"`) badge appears while the
      run is active.
- [ ] Verify delegation entries (`data-testid="delegation-entry"`)
      stream in as the supervisor calls each sub-agent.
- [ ] Verify the entries are tagged with the correct sub-agent label:
      Research / Writing / Critique, with their respective emoji
      (🔎 / ✍️ / 🧐).
- [ ] Verify each entry shows: - a "#1", "#2", "#3" index - the task text the supervisor passed in - the sub-agent's text result in the white inner panel - a "completed" status pill
- [ ] Verify the delegation count updates to match the number of
      entries.

### 3. Subsequent runs accumulate

- [ ] After the first run finishes, click "Explain a topic". Verify
      new delegation entries are APPENDED to the log (not replacing
      the previous run's entries).
- [ ] Verify entries from both runs remain visible.

### 4. Ad-hoc delegation

- [ ] Send a freeform message: "Just research the topic of LLM
      tokenization, no draft needed."
- [ ] Verify only a Research delegation entry appears (the supervisor
      is not forced to run all three).

### 5. Suggestions

- [ ] Verify "Write a blog post", "Explain a topic", and "Summarize a
      topic" suggestion buttons are visible.

### 6. Error Handling

- [ ] Send an empty message — should be ignored or handled gracefully.
- [ ] Verify no console errors during normal usage.
- [ ] If a sub-agent errors, the delegation entry should still appear
      with a clear error result string (prefixed with
      `[sub-agent error]`).

## Expected Results

- Delegation log loads within 3 seconds.
- Supervisor responds within 30 seconds for the canonical
  research -> write -> critique flow (slower than other demos because
  three nested LLM calls run sequentially).
- Each delegation entry surfaces in the log without a page refresh.
- The delegation count matches the number of entries shown.
- No UI errors or broken layouts.
