# QA: In-App Human in the Loop — Spring AI

## Prerequisites
- Demo is deployed and accessible

## Test Steps
- [ ] Navigate to `/demos/hitl-in-app`
- [ ] Verify the tickets panel renders three mock tickets
- [ ] Ask "Approve a $50 refund to Jordan Rivera on ticket #12345"
- [ ] Verify an ApprovalDialog modal appears outside the chat
- [ ] Click Approve with an optional note
- [ ] Verify the agent receives the approval and confirms the action

## Expected Results
- Modal appears outside the chat surface
- Approve/Reject resolves the pending tool Promise
