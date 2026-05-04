# QA — byoc-json-render

## Scope

Manual QA checklist for the `byoc-json-render` demo. The agent emits a
`{ root, elements }` JSON spec that `@json-render/react`'s `<Renderer>`
mounts against a Zod-validated catalog.

## Happy path

- [ ] Navigate to `/demos/byoc-json-render`.
- [ ] Page renders, chat composer shows suggestion pills.
- [ ] Click "Sales dashboard" — the assistant replies with a rendered
      dashboard (MetricCard + BarChart) rather than raw JSON.
- [ ] Click "Revenue by category" — the assistant replies with a PieChart
      with 4 segments.
- [ ] Click "Expense trend" — the assistant replies with a BarChart.

## Regression

- [ ] `data-testid="json-render-root"` is present on the rendered
      assistant message wrapper.
- [ ] `data-testid="metric-card"` appears when a MetricCard is the root.
- [ ] Nested children of MetricCard (e.g. the BarChart in the Sales
      Dashboard worked example) render — they are NOT silently dropped
      (PR #4271 fix).
- [ ] No "useVisibility must be used within a VisibilityProvider" crash
      (PR #4271 fix — `<JSONUIProvider>` wraps `<Renderer>`).

## Known gaps

- Uses the shared Strands backend via the prompt injected on the frontend;
  canonical prompt lives in `src/agents/byoc_json_render.py`.
