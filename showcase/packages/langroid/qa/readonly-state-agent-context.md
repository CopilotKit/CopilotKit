# QA: Readonly State (Agent Context) — Langroid

## Test Steps

- [ ] Navigate to /demos/readonly-state-agent-context
- [ ] Verify the context card renders with default Name "Atai"
- [ ] Change Name to "Jordan", verify published JSON updates
- [ ] Toggle recent-activity checkboxes, verify JSON updates
- [ ] Ask "What do you know about me?" — agent should reference the context values
- [ ] Change timezone, ask "What time is it for me?" — agent should reflect the new zone
