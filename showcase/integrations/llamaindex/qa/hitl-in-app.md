# QA: HITL In-App — LlamaIndex

## Prerequisites

- Demo is deployed and accessible

## Test Steps

- [ ] Navigate to `/demos/hitl-in-app`
- [ ] Verify the support-tickets panel is visible on the left
- [ ] Verify CopilotChat is visible on the right
- [ ] Send "Approve a $50 refund for ticket #12345"
- [ ] Verify the ApprovalDialog (`data-testid="approval-dialog"`) pops up
- [ ] Click "Approve" and verify dialog closes
- [ ] Verify the agent continues with a confirmation message

## Expected Results

- Modal pops up outside the chat, portal'd to body
- Approve/Reject resolves the awaiting promise in the frontend tool handler
