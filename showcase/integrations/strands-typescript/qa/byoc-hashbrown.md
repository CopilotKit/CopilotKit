# QA — byoc-hashbrown

## Scope

Manual QA checklist for the `byoc-hashbrown` demo in the AWS Strands
showcase. The agent emits a hashbrown JSON envelope that `@hashbrownai/react`
progressively parses and renders via the MetricCard / PieChart / BarChart /
DealCard / Markdown catalog.

## Happy path

- [ ] Navigate to `/demos/byoc-hashbrown`.
- [ ] Page renders with header "BYOC: Hashbrown" and no console errors.
- [ ] Suggestion pills appear in the composer (Sales dashboard, Revenue by
      category, Expense trend).
- [ ] Click "Sales dashboard" — the assistant replies with a progressively
      streaming dashboard that includes at least one metric card, one pie
      chart, and one bar chart.
- [ ] Click "Revenue by category" — the assistant replies with a pie chart
      with 4+ segments.
- [ ] Click "Expense trend" — the assistant replies with a bar chart.

## Regression

- [ ] The assistant's response is rendered as a visual dashboard (NOT as
      raw JSON in a chat bubble).
- [ ] `data-testid="metric-card"`, `data-testid="pie-chart"`, and
      `data-testid="bar-chart"` are present on their respective elements.
- [ ] No hydration warnings.

## Known gaps

- The Strands backend uses the shared agent from `agent.py`; the
  hashbrown JSON envelope prompt is injected via `useAgentContext` on the
  frontend. The canonical prompt lives in `src/agents/byoc_hashbrown.py`
  as documentation.
