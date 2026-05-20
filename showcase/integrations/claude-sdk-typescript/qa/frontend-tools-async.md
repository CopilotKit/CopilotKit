# QA: Frontend Tools (Async) — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy

## Test Steps

- [ ] Navigate to /demos/frontend-tools-async
- [ ] Ask the agent to fetch a note (e.g. "Look up my note about project kickoff")
- [ ] Verify the async `query_notes` tool fires and resolves
- [ ] Verify the agent uses the resolved note content in its reply
- [ ] Verify no console errors

## Expected Results

- Async tool resolution is awaited and surfaced correctly
- No UI errors
