# QA: Frontend Tools (Async) — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy
- ANTHROPIC_API_KEY is set

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/frontend-tools-async`
- [ ] Verify the chat renders
- [ ] Click the "Find project-planning notes" suggestion
- [ ] Verify a NotesCard appears briefly in loading state ("Querying local notes DB...")
- [ ] After ~500ms, verify the card shows matching notes (Q2 kickoff, migrate auth to passkeys, retrospective notes, career planning)

### 2. Feature-Specific Checks

- [ ] Search for "auth" — verify the "migrate auth to passkeys" note is returned
- [ ] Ask "Do I have notes tagged reading?" — verify the Book recommendations note appears
- [ ] Search for "nonsense-keyword-no-match" — verify "No notes matched." empty state

### 3. Error Handling

- [ ] Verify no console errors during search
- [ ] Verify the loading state transitions to complete within a few seconds

## Expected Results

- NotesCard with `data-testid="notes-card"` displays matching notes
- Each note rendered with `data-testid="note-<id>"` and tags
