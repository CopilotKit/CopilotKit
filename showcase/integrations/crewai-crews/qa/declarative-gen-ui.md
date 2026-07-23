# QA: Declarative Generative UI (A2UI - Dynamic Schema) — CrewAI (Crews)

- [ ] Navigate to `/demos/declarative-gen-ui`.
- [ ] Verify the page root (`data-testid="declarative-gen-ui-root"`) renders.
- [ ] Verify the composer renders four pre-seeded suggestions pills.
- [ ] Click the "Show a KPI dashboard" pill; verify the agent calls
      `generate_a2ui` and a Card with 3-4 Metric children appears.
- [ ] Click the "Pie chart — sales by region" pill; verify a PieChart
      renders with brand colours and a readable legend.
- [ ] Click the "Bar chart — quarterly revenue" pill; verify a BarChart
      renders with four labelled bars.
- [ ] Click the "Status report" pill; verify a Card with StatusBadge
      children renders (API / database / workers).
- [ ] Type a free-form prompt ("Show me a pie chart of traffic sources")
      and send; verify the agent falls through the suggestion flow and
      still emits a PieChart.
