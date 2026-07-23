# QA: BYOC hashbrown — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- `ANTHROPIC_API_KEY` is set on the deployment

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/byoc-hashbrown`
- [ ] Verify the header "BYOC: Hashbrown" renders
- [ ] Verify the description paragraph mentions `@hashbrownai/react`

### 2. Feature-Specific Checks

#### Q4 Sales Summary (mixed catalog)

- [ ] Send "Show me a Q4 sales summary" (or click a suggestion)
- [ ] Verify a `data-testid="metric-card"` renders with a formatted value
- [ ] Verify a `data-testid="pie-chart"` renders with at least three
      legend rows
- [ ] Verify a `data-testid="bar-chart"` renders with at least three
      columns
- [ ] Verify at least one Markdown heading renders inline

#### Deal card

- [ ] Ask "Show me a sample deal in the negotiation stage"
- [ ] Verify a `data-testid="hashbrown-deal-card"` renders with a stage
      badge

### 3. Streaming behaviour

- [ ] Observe components progressively appear as Claude streams the
      JSON envelope — no full-refresh flash at the end of streaming

### 4. Error Handling

- [ ] No console errors during normal usage.
- [ ] No hashbrown schema-validation errors logged.

## Expected Results

- Chat loads within 3 seconds
- Agent responds within 15 seconds
- Backend emits the JSON envelope (`{ui: [...]}`), NEVER XML
