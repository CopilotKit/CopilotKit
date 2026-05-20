# QA: In-App HITL — CrewAI (Crews)

- [ ] Navigate to `/demos/hitl-in-app`.
- [ ] Verify the tickets panel with 3 rows (ticket-12345, ticket-12346, ticket-12347) is visible on the left.
- [ ] Click "Approve refund for #12345" suggestion.
- [ ] Verify the `ApprovalDialog` modal (`data-testid="approval-dialog"`) pops up OUTSIDE the chat surface (portal'd to body).
- [ ] Verify it shows the action summary and context with Approve / Reject buttons.
- [ ] Click Approve; verify the dialog closes and the agent acknowledges the approval.
- [ ] Trigger another action; click Reject; verify the agent acknowledges the rejection.
