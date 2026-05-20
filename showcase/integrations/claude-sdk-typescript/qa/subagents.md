# QA: Sub-Agents — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo deployed and accessible at `/demos/subagents`
- Agent backend healthy (`GET /api/copilotkit-subagents`)
- `ANTHROPIC_API_KEY` set on the agent backend
- Optional: `ANTHROPIC_SUBAGENT_MODEL` (or `CLAUDE_SUBAGENT_MODEL`) set
  if you want the secondary calls to use a different model than the
  supervisor

## Test Steps

### 1. Page loads

- [ ] Navigate to `/demos/subagents`
- [ ] Main panel shows a **Sub-agent delegations** card with header
      `0 calls` and an italic placeholder "Ask the supervisor to
      complete a task."
- [ ] Right panel shows the chat with placeholder
      "Give the supervisor a task..."
- [ ] Three suggestion chips visible:
      "Write a blog post", "Explain a topic", "Summarize a topic"
- [ ] No console errors

### 2. Single delegation flow

- [ ] Click "Explain a topic" (or send a similar prompt)
- [ ] Supervisor running badge appears in the header
- [ ] A delegation entry appears with sub-agent = `Research`,
      status = `running`, an italic "Waiting for sub-agent…" placeholder
- [ ] Within ~15s the entry flips to `completed` and shows a bulleted
      list of facts
- [ ] A second delegation entry (`Writing`) appears with `running`,
      then flips to `completed` showing a 1-paragraph draft
- [ ] A third entry (`Critique`) appears, runs, and completes with
      2-3 critiques
- [ ] Delegation count in the header reads `3 calls`
- [ ] Supervisor running badge disappears once the run finishes
- [ ] Supervisor's final chat message is a brief summary

### 3. Live state streaming

- [ ] During step 2, observe the panel updating without scrolling /
      reloading: each `running -> completed` transition is visible
- [ ] The order of entries in the panel matches the order the
      supervisor called them (research first, then writing, then
      critique)
- [ ] Each entry's task text matches what the supervisor passed (e.g.
      writing entry references the research output)

### 4. Multi-turn

- [ ] After the first run completes, send a follow-up like
      "Now do the same for renewable energy storage"
- [ ] New delegations are appended to the existing log (count goes
      up); previous entries remain visible

### 5. Error handling

- [ ] Send an empty message — handled gracefully
- [ ] If a sub-agent call fails (e.g. revoke API key transiently),
      the delegation entry shows status `failed` with the error
      message; the supervisor continues / surfaces the failure
      instead of fabricating a result
- [ ] No unhandled console errors in the happy path

## Expected Results

- Each sub-agent invocation produces exactly one entry in the
  delegation log
- Entries transition `running` -> `completed` (or `failed`) live, via
  AG-UI `STATE_SNAPSHOT`
- Status badges are colour-coded (yellow for running, green for
  completed, red for failed)
- The supervisor's text replies stay short — the bulk of the output
  lives in the delegation log
- Total run time is bounded (no runaway loops); MAX_TOOL_ITERATIONS = 10
