# QA: Frontend Tools (Async) — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the frontend-tools-async demo page
- [ ] Verify the chat interface loads

### 2. Async Tool Execution

- [ ] Send "Find my notes about project planning"
- [ ] Verify the NotesCard (`data-testid="notes-card"`) renders
- [ ] Verify the loading state shows "Querying local notes DB..."
- [ ] After ~500ms, verify the notes-list renders with matching notes
- [ ] Verify the agent summarizes the notes in the chat reply

### 3. Empty Result

- [ ] Send "Search my notes for xyzabcnonsense"
- [ ] Verify the "No notes matched." fallback renders

### 4. Error Handling

- [ ] Verify no console errors during normal usage

## Expected Results

- Agent awaits the async client-side handler before composing its reply
- The notes query runs entirely in the browser
- No UI errors or broken layouts
