# QA: Headless Chat (Simple) — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the headless-simple demo page
- [ ] Verify the "Headless Chat (Simple)" heading is visible
- [ ] Verify the scrollable message area and text input are visible

### 2. Chat Interaction

- [ ] Send "say hi"
- [ ] Verify the user bubble (blue, right-aligned) renders
- [ ] Verify the assistant bubble (gray, left-aligned) renders

### 3. useComponent Tool

- [ ] Send "show a card about cats"
- [ ] Verify a ShowCard renders with a title and body (via useComponent)

### 4. Error Handling

- [ ] Verify no console errors during normal usage

## Expected Results

- Chat runs entirely on useAgent — no CopilotChat component used
- Agent responds within 10 seconds
- ShowCard tool renders when requested
