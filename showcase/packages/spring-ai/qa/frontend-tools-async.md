# QA: Frontend Tools (Async) — Spring AI

## Prerequisites

- Demo is deployed and accessible

## Test Steps

- [ ] Navigate to `/demos/frontend-tools-async`
- [ ] Ask "Find my notes about project planning"
- [ ] Verify the NotesCard shows a loading state briefly (simulated 500ms latency)
- [ ] Verify the NotesCard then renders with matching notes
- [ ] Verify the agent's text summary references the found notes

## Expected Results

- Async frontend tool resolves correctly and the agent receives the result
