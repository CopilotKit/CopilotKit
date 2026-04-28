# QA: Readonly State (Agent Context) — Mastra

## Test Steps

- [ ] Navigate to `/demos/readonly-state-agent-context`
- [ ] Verify the context card (`data-testid="context-card"`) renders with name, timezone, and activity checkboxes
- [ ] Change name to "Alice"
- [ ] Send "What do you know about me?"
- [ ] Verify the agent mentions "Alice" in its response
- [ ] Toggle an activity checkbox; ask "What have I been doing recently?"
- [ ] Verify the updated activity list is reflected in the response

## Expected Results

- `useAgentContext` forwards the state to the agent per turn
- Agent mentions the exact context values in its reply
