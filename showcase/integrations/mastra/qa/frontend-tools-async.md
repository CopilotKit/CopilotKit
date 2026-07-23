# QA: Frontend Tools (Async) — Mastra

## Test Steps

- [ ] Navigate to `/demos/frontend-tools-async`
- [ ] Send: "Find my notes about project planning."
- [ ] Verify the `NotesCard` renders (`data-testid="notes-card"`) with matches
- [ ] Verify the keyword header reads "Matching \"project planning\"" or similar

## Expected Results

- Async handler resolves after ~500ms
- Matched notes render inside the card
