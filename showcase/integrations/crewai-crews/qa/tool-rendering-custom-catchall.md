# QA: Tool Rendering (Custom Catch-all) — CrewAI (Crews)

- [ ] Navigate to `/demos/tool-rendering-custom-catchall`.
- [ ] Ask "What's the weather in SF?".
- [ ] Verify the branded `CustomCatchallRenderer` card renders (`data-testid="custom-catchall-card"`) with:
  - [ ] tool name, status badge (streaming -> running -> done).
  - [ ] collapsible Arguments and Result sections.
