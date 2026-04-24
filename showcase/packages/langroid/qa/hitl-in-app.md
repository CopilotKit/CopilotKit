# QA: HITL In-App — Langroid

## Test Steps
- [ ] Navigate to /demos/hitl-in-app
- [ ] Verify the tickets panel renders with tickets #12345, #12346, #12347
- [ ] Ask "Please approve a $50 refund to Jordan Rivera on ticket #12345."
- [ ] Verify an approval dialog (`approval-dialog` testid) appears OUTSIDE the chat
- [ ] Click Approve; verify the dialog closes and the agent acknowledges the decision in chat
- [ ] Repeat with a Reject decision
