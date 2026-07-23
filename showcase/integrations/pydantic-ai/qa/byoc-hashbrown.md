# QA: BYOC hashbrown — PydanticAI

## Prerequisites

- Demo deployed and accessible at `/demos/byoc-hashbrown`
- Agent backend healthy (check `/api/health`)
- `OPENAI_API_KEY` set

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/byoc-hashbrown`
- [ ] Verify the header "BYOC: Hashbrown" is visible
- [ ] Verify the suggestion pills render ("Sales dashboard",
      "Revenue by category", "Expense trend")

### 2. Sales dashboard

- [ ] Click "Sales dashboard"
- [ ] Within 20 seconds, a progressively-assembled UI renders via
      `@hashbrownai/react`'s `useJsonParser` + `useUiKit` — assert at
      least one `data-testid="metric-card"` and one chart container
      (`pie-chart` or `bar-chart`) is visible

### 3. Revenue by category

- [ ] Click "Revenue by category"
- [ ] Within 20 seconds, a pie chart renders
      (`data-testid="pie-chart"` visible)

### 4. Expense trend

- [ ] Click "Expense trend"
- [ ] Within 20 seconds, a bar chart renders
      (`data-testid="bar-chart"` visible)

## Known Limitations vs. langgraph-python port

- None in scope for parity — the agent emits the same JSON envelope
  `{"ui": [{componentName: {"props": {...}}}]}` the frontend
  `useJsonParser` expects.

## Expected Results

- Dashboard / pie / bar chart render progressively via hashbrown's
  streaming JSON parser; the assistant message bubble is replaced with
  the hashbrown UI kit output.
