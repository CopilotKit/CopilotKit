# QA: Background Agents — Mastra

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the background-agents demo page
- [ ] Verify the chat interface loads in a centered full-height layout
- [ ] Verify the chat input placeholder "Type a message" is visible
- [ ] Verify no background-task activity card is present on first paint

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Research AI agent frameworks" suggestion button is visible
- [ ] Verify "Investigate renewable energy trends" suggestion button is visible

#### Background task → activity card

- [ ] Click "Research AI agent frameworks" (or type "Kick off deep research on
      the current landscape of AI agent frameworks")
- [ ] Verify a background-task activity card renders inline in the transcript
      (`data-testid="background-task-activity"`)
- [ ] Verify the card shows the "Deep research" title and the topic text
- [ ] Verify the card status reads "Working…" with an animated spinner
      (`data-testid="background-task-status"`)
- [ ] Verify NO orphan `run_deep_research` tool pill appears — the backgrounded
      tool call is suppressed and surfaces ONLY as the activity card
- [ ] Verify the assistant sends a short message noting the task is running in
      the background

### 3. Out-of-band completion (expected behavior, not a bug)

- [ ] Note that the card stays in the "Working…" state within the turn. Mastra
      delivers background-task completion OUT OF BAND (on a later turn), so the
      dispatching run's stream carries only the `started` lifecycle plus a
      placeholder result. Do NOT expect the card to animate to "Completed"
      within the same turn.

### 4. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results

- Chat loads within 3 seconds
- The activity card appears within a few seconds of dispatching research
- The card reads "Working…" (running state) — completion is out of band
- No orphan tool pill, no UI errors or broken layouts
