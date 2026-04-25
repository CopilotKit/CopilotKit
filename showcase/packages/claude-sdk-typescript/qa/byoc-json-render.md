# QA: BYOC json-render — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/copilotkit)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/byoc-json-render`
- [ ] Verify the chat interface loads
- [ ] Verify three suggestion pills are visible ("Sales dashboard", "Revenue by category", "Expense trend")

### 2. Feature-Specific Checks

- [ ] Click "Sales dashboard" suggestion
- [ ] Wait for Claude to reply. Verify the assistant message renders a MetricCard and a BarChart (not raw JSON).
- [ ] Click "Revenue by category" suggestion
- [ ] Verify a PieChart renders.
- [ ] Click "Expense trend" suggestion
- [ ] Verify a BarChart renders.
- [ ] Type "Show me a free-form sentence" and verify the assistant falls back to plain text (Claude should still return JSON per the prompt, but the renderer falls through to the default bubble if the content isn't a valid spec).

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results

- Chat loads within 3 seconds
- Claude responds within 15 seconds
- Structured JSON output renders through `@json-render/react`'s `<Renderer />` with the three catalog components
