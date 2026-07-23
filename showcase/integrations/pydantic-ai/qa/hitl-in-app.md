# QA: In-App Human in the Loop — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the hitl-in-app demo page
- [ ] Verify the tickets panel renders with three mock tickets
- [ ] Verify the chat surface renders on the right

### 2. Approval Flow

- [ ] Click "Approve refund for #12345" suggestion
- [ ] Verify the agent calls `request_user_approval`
- [ ] Verify the approval dialog (`data-testid="approval-dialog"`) appears as an app-level modal
- [ ] Verify the dialog message includes the refund amount and customer
- [ ] Click Approve — verify the dialog closes and the agent confirms the action
- [ ] Repeat, this time clicking Reject — verify the agent acknowledges rejection

### 3. Note Field

- [ ] Before approving/rejecting, type a note in the reason textarea
- [ ] Verify the note is echoed back by the agent

### 4. Error Handling

- [ ] Verify no console errors during normal usage

## Expected Results

- Approval dialog renders as a portal'd modal on top of the page
- Agent awaits the decision before continuing
- No UI errors or broken layouts
