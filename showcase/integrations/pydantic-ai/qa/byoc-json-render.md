# QA: BYOC json-render — PydanticAI

## Prerequisites

- Demo deployed and accessible at `/demos/byoc-json-render`
- Agent backend healthy (check `/api/health`)
- `OPENAI_API_KEY` set

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/byoc-json-render`
- [ ] Verify the chat UI renders and suggestion pills are visible
      ("Sales dashboard", "Revenue by category", "Expense trend")

### 2. Sales dashboard

- [ ] Click the "Sales dashboard" suggestion
- [ ] Within 15 seconds, a `@json-render/react`-rendered `MetricCard`
      appears with a nested `BarChart` child — assert the
      `data-testid="metric-card"` and `data-testid="bar-chart"`
      elements are both visible under `data-testid="json-render-root"`

### 3. Pie chart

- [ ] Click "Revenue by category"
- [ ] Within 15 seconds, a `PieChart` renders inline
      (`data-testid="pie-chart"` visible)

### 4. Bar chart only

- [ ] Click "Expense trend"
- [ ] Within 15 seconds, a standalone `BarChart` renders

## Known Limitations vs. langgraph-python port

- None in scope for parity — the catalog shape, suggestion prompts, and
  renderer tree are byte-compatible with the langgraph-python reference.

## Expected Results

- Dashboard / pie / bar chart render inline via `@json-render/react`
  against the catalog in `./catalog.ts`. The assistant message bubble
  is swapped for `JsonRenderAssistantMessage` once the content parses.
