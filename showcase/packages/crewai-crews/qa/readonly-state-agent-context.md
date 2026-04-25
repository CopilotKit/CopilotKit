# QA: Readonly State (Agent Context) — CrewAI (Crews)

- [ ] Navigate to `/demos/readonly-state-agent-context`.
- [ ] Verify the `Agent Context` card renders on the left (`data-testid="context-card"`).
- [ ] Verify name input (`data-testid="ctx-name"`), timezone select (`data-testid="ctx-timezone"`), recent activity checkboxes, and state JSON pane are all visible.
- [ ] Change name to "Alex"; verify `ctx-state-json` updates.
- [ ] Ask "What do you know about me from my context?"; verify the agent cites name, timezone, recent activity.
