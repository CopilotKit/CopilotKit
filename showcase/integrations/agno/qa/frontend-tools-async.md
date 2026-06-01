# QA: Frontend Tools (Async) — Agno

## Prerequisites

- Demo deployed at `/demos/frontend-tools-async`
- Agent backend healthy

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/frontend-tools-async`
- [ ] Verify the chat renders

### 2. Feature-Specific Checks

- [ ] Click the "Find project-planning notes" suggestion pill
- [ ] Verify a `data-testid="notes-card"` appears
- [ ] Verify `data-testid="notes-keyword"` shows the searched keyword
- [ ] Verify matching notes (`data-testid="note-n1"` etc.) are rendered

### 3. Error Handling

- [ ] No uncaught console errors
