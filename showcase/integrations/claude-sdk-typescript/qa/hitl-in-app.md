# QA: In-App Human-in-the-Loop — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy

## Test Steps

- [ ] Navigate to /demos/hitl-in-app
- [ ] Ask the agent to perform an action that requires approval
- [ ] Verify the approval dialog renders OUTSIDE the chat (app-level modal)
- [ ] Approve the action and verify the agent continues with the user's decision
- [ ] Repeat with rejection and verify the agent honors it
- [ ] Verify no console errors

## Expected Results

- Async frontend tool blocks until user resolves the modal
- Agent outcome differs between approve and reject
- No UI errors
