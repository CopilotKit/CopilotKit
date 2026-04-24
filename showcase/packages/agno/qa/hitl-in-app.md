# QA: In-App HITL (frontend-tool + app-level modal) — Agno

## Prerequisites

- Demo deployed at `/demos/hitl-in-app`
- Agent backend healthy

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/hitl-in-app`
- [ ] Verify the support-inbox panel and three tickets (`#12345`, `#12346`, `#12347`) render
- [ ] Verify chat renders on the right

### 2. Feature-Specific Checks

- [ ] Click the "Approve refund for #12345" suggestion
- [ ] Verify the approval dialog (`data-testid="approval-dialog"`) appears OUTSIDE the chat (overlays the page)
- [ ] Click "Approve"
- [ ] Verify the dialog closes and the agent continues with a follow-up

#### Reject path

- [ ] Click "Downgrade plan for #12346"
- [ ] When the dialog appears, click "Reject"
- [ ] Verify the agent acknowledges the rejection

### 3. Error Handling

- [ ] No uncaught console errors
