# QA: Declarative Generative UI (A2UI — Dynamic Schema) — LlamaIndex

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the declarative-gen-ui demo page
- [ ] Verify the chat interface loads with placeholder "Type a message"
- [ ] Click the "Show a KPI dashboard" suggestion
- [ ] Verify an A2UI surface renders with Metric components

### 2. Chart Variants

- [ ] Click the "Pie chart — sales by region" suggestion
- [ ] Verify a PieChart renders with a donut and legend
- [ ] Click the "Bar chart — quarterly revenue" suggestion
- [ ] Verify a BarChart renders with labeled bars

### 3. Status Report

- [ ] Click the "Status report" suggestion
- [ ] Verify a Card with StatusBadge components renders
