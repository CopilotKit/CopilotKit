# QA: BYOC json-render — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- `ANTHROPIC_API_KEY` is set on the deployment

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/byoc-json-render`
- [ ] Verify the chat surface loads inside the centered 4xl container
- [ ] Verify the three suggestion pills are visible:
      "Sales dashboard", "Revenue by category", "Expense trend"

### 2. Feature-Specific Checks

#### Sales dashboard (MetricCard + BarChart)

- [ ] Click the "Sales dashboard" suggestion pill
- [ ] Verify a `data-testid="metric-card"` element renders with a label
      and a dollar-formatted value
- [ ] Verify a `data-testid="bar-chart"` element renders inside the same
      `data-testid="json-render-root"` wrapper

#### Revenue by category (PieChart)

- [ ] Click "Revenue by category"
- [ ] Verify a `data-testid="pie-chart"` element renders with at least
      three legend rows

#### Expense trend (BarChart)

- [ ] Click "Expense trend"
- [ ] Verify `data-testid="bar-chart"` renders with three months of data

### 3. Streaming behaviour

- [ ] Observe the raw JSON streaming into the chat bubble briefly while
      the model emits the spec
- [ ] Verify the catalog components swap in cleanly once the JSON
      becomes valid — no flicker, no duplicate render

### 4. Error Handling

- [ ] Ask a free-form question that has nothing to do with dashboards
      (e.g. "What is 2+2?"). The agent should still reply with a JSON
      spec — it may emit a single MetricCard — and the page must NOT
      white-screen.
- [ ] No console errors during normal usage.

## Expected Results

- Chat loads within 3 seconds
- Agent responds within 15 seconds (Claude opus)
- Components render from the json-render catalog wrapped in a single
  `<JSONUIProvider>` (no missing-provider crashes)
