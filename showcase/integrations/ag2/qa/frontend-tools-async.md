# QA: Frontend Tools (Async) — AG2

- [ ] Navigate to /demos/frontend-tools-async
- [ ] Click "Find project-planning notes"
- [ ] Verify NotesCard loading state ("Querying local notes DB...")
- [ ] After ~500ms, verify matches render (notes-list)
- [ ] Verify agent summarizes the notes in the next assistant bubble

## Expected Results

- Async frontend-tool handler waits and returns data to the agent
