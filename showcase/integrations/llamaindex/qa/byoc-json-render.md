# QA: BYOC json-render — LlamaIndex

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the byoc-json-render demo page
- [ ] Verify the chat interface loads with placeholder "Type a message"

### 2. Dashboard Rendering

- [ ] Click the "Sales dashboard" suggestion
- [ ] Verify a MetricCard renders with a value and trend
- [ ] Verify a BarChart renders with bars
- [ ] Verify the chart has a title and description

### 3. Chart-Only Variants

- [ ] Ask for a pie chart of revenue by category
- [ ] Verify a PieChart renders with a donut and legend
