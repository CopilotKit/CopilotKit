# QA: Frontend Tools — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the frontend-tools demo page
- [ ] Verify the chat interface loads
- [ ] Verify the background container (`data-testid="background-container"`) is visible

### 2. Frontend Tool Execution

- [ ] Send "Change the background to a blue-to-purple gradient"
- [ ] Verify the change_background tool is called and the background style updates
- [ ] Send "Make the background a sunset-themed gradient"
- [ ] Verify the background updates to a sunset gradient

### 3. Suggestions

- [ ] Verify "Change background" and "Sunset theme" suggestions render
- [ ] Click a suggestion and verify it sends the message

### 4. Error Handling

- [ ] Verify no console errors during normal usage

## Expected Results

- Agent invokes the client-side handler via useFrontendTool
- Background changes happen in the browser, without a backend round-trip
- No UI errors or broken layouts
