# QA: BYOC (json-render) — CrewAI (Crews)

- [ ] Navigate to `/demos/byoc-json-render`.
- [ ] Verify the page root (`data-testid="byoc-json-render-root"`) renders.
- [ ] Verify the composer shows the pre-seeded suggestion pills.
- [ ] Click a suggestion that exercises multi-component output (sales
      dashboard with metric + chart); verify the MetricCard renders WITH
      a nested BarChart below it (children forwarding works).
- [ ] Click a pie-chart suggestion; verify the PieChart renders without a
      React console error like "useVisibility must be used within a
      VisibilityProvider" (JSONUIProvider must wrap Renderer).
- [ ] Click a bar-chart suggestion; verify the BarChart renders with
      correctly-labelled bars.
- [ ] Verify that, while the agent is mid-stream, the default assistant
      message bubble shows the streaming text; once the JSON is complete,
      the view switches to the rendered components.
