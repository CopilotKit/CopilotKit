# QA: BYOC Hashbrown — LlamaIndex

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the byoc-hashbrown demo page
- [ ] Verify the chat interface loads with placeholder "Type a message"

### 2. Dashboard Rendering

- [ ] Click the "Q4 sales summary" suggestion
- [ ] Verify metric cards render with values and trends
- [ ] Verify a pieChart renders progressively as the stream arrives
- [ ] Verify a barChart renders progressively

### 3. Deal Cards

- [ ] Ask for a list of open deals
- [ ] Verify `dealCard` entries render with stage badges
