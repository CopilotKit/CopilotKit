# QA: Tool Rendering (Default Catch-all) — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the tool-rendering-default-catchall demo page
- [ ] Verify the chat interface loads

### 2. Default Tool Rendering

- [ ] Send "What's the weather in San Francisco?"
- [ ] Verify CopilotKit's built-in default tool-call card renders (with tool name, status pill, and Arguments / Result sections)
- [ ] Verify the status transitions Running → Done as the call resolves

### 3. Multi-Tool

- [ ] Send "Add 3 sales todos for Q2 prospecting"
- [ ] Verify each tool call renders its own default card

### 4. Error Handling

- [ ] Verify no console errors during normal usage

## Expected Results

- Default tool renderer visible for every tool call without custom frontend code
- Agent responds within 30 seconds
- No UI errors or broken layouts
