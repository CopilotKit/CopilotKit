# QA: Tool Rendering (Custom Catch-all) — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the tool-rendering-custom-catchall demo page
- [ ] Verify the chat interface loads

### 2. Custom Catch-all Rendering

- [ ] Send "What's the weather in San Francisco?"
- [ ] Verify the CustomCatchallRenderer (`data-testid="custom-catchall-card"`) renders
- [ ] Verify the card shows the tool name, status badge, Arguments section, and Result section
- [ ] Verify the status badge transitions streaming → running → done

### 3. Multi-Tool

- [ ] Send "Add 3 sales todos"
- [ ] Verify each tool call uses the same branded custom card

### 4. Error Handling

- [ ] Verify no console errors during normal usage

## Expected Results

- Single wildcard renderer paints every tool call
- Agent responds within 30 seconds
- No UI errors or broken layouts
