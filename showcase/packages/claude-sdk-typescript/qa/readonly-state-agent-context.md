# QA: Readonly State (Agent Context) — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy

## Test Steps

- [ ] Navigate to /demos/readonly-state-agent-context
- [ ] Verify the page renders the read-only context surface on the left
- [ ] Ask the agent about the context values (e.g. "What is my current plan?")
- [ ] Verify the agent's reply references the context values exposed via `useAgentContext`
- [ ] Update the context on the page and verify the agent's next answer reflects the change
- [ ] Verify no console errors

## Expected Results

- Agent consistently sees the frontend-provided context
- No UI errors
