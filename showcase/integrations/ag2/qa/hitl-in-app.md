# QA: In-App HITL — AG2

- [ ] Navigate to /demos/hitl-in-app
- [ ] Verify tickets panel on left, chat on right
- [ ] Click suggestion "Approve refund for #12345"
- [ ] Verify approval dialog modal appears (`data-testid="approval-dialog"`) OUTSIDE the chat
- [ ] Click Approve
- [ ] Verify dialog closes and agent acknowledges approval in chat

## Expected Results

- App-level modal routes through async useFrontendTool Promise
