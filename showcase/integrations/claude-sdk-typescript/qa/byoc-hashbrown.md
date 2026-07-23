# QA: BYOC hashbrown — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/copilotkit)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/byoc-hashbrown`
- [ ] Verify the chat interface loads with the BYOC hashbrown header
- [ ] Verify three suggestion pills are visible ("Sales dashboard", "Revenue by category", "Expense trend")

### 2. Feature-Specific Checks

- [ ] Click "Sales dashboard" suggestion
- [ ] Wait for Claude to reply. Verify the assistant message renders MetricCards + BarChart + PieChart progressively via hashbrown's `useJsonParser`.
- [ ] Click "Revenue by category" suggestion
- [ ] Verify a PieChart renders.
- [ ] Click "Expense trend" suggestion
- [ ] Verify a BarChart renders.

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results

- Chat loads within 3 seconds
- Claude responds within 15 seconds
- hashbrown progressive parser assembles UI from streaming JSON envelope
