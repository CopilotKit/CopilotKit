# QA: Frontend Tools (Async) — LlamaIndex

## Prerequisites

- Demo is deployed and accessible

## Test Steps

- [ ] Navigate to `/demos/frontend-tools-async`
- [ ] Verify the chat loads and suggestions are visible
- [ ] Send "Find my notes about project planning"
- [ ] Verify NotesCard (`data-testid="notes-card"`) renders with matching notes
- [ ] Verify "Querying local notes DB..." loading state appears briefly
- [ ] Verify notes-list shows the expected note titles

## Expected Results

- Async frontend tool handler awaits ~500ms before returning notes
- Agent's summary references the returned notes
