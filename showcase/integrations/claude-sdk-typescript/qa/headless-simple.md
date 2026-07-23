# QA: Headless Chat (Simple) — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy

## Test Steps

- [ ] Navigate to /demos/headless-simple
- [ ] Verify a minimal custom chat surface renders (not `<CopilotChat />`)
- [ ] Verify the input field and send affordance are visible
- [ ] Send a message and verify the agent's response appears in the custom list
- [ ] Verify no console errors

## Expected Results

- Custom UI built via `useAgent` works end-to-end against the Claude pass-through
- No layout or runtime errors
