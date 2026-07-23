# QA: HITL In-App — Mastra

## Test Steps

- [ ] Navigate to `/demos/hitl-in-app`
- [ ] Verify the Support Inbox panel with three mock tickets is rendered
- [ ] Click the "Approve refund for #12345" suggestion
- [ ] Verify `data-testid="approval-dialog"` renders as a modal
- [ ] Click Approve; verify the dialog closes and the agent receives the decision
- [ ] Optionally repeat with Reject

## Expected Results

- The agent resumes after the modal resolves the frontend-tool Promise
- The assistant's follow-up message reflects the approval decision
