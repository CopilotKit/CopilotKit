# QA: In-App HITL — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- ANTHROPIC_API_KEY is set

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/hitl-in-app`
- [ ] Verify the Support Inbox renders three tickets (#12345, #12346, #12347)
- [ ] Verify the chat surface renders on the right

### 2. Approval Flow

- [ ] Click the "Approve refund for #12345" suggestion
- [ ] Verify a modal dialog appears with the action summary
- [ ] Click "Approve" — verify the dialog closes and the agent confirms

### 3. Rejection Flow

- [ ] Click the "Downgrade plan for #12346" suggestion
- [ ] Verify the modal appears
- [ ] Add a note "Customer needs to stay on current plan"
- [ ] Click "Reject" — verify the agent acknowledges the rejection

### 4. Error Handling

- [ ] Verify no console errors during the approval/rejection flows
- [ ] Verify the modal blocks interaction with the chat until resolved

## Expected Results

- Modal uses `fixed inset-0` overlay rather than a portal (to avoid @types/react-dom)
- Agent accurately reflects the approve/reject outcome
