# QA: Readonly State (Agent Context) — AG2

- [ ] Navigate to /demos/readonly-state-agent-context
- [ ] Verify context card (`data-testid="context-card"`)
- [ ] Change name in `data-testid="ctx-name"` input
- [ ] Toggle an activity checkbox
- [ ] Send "Who am I?"
- [ ] Verify agent reflects the context (name, timezone, activities)

## Expected Results

- useAgentContext values visibly propagate into agent's replies
