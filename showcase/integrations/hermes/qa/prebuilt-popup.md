# QA: Pre-Built Popup — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the prebuilt-popup demo page
- [ ] Verify the main content heading ("Popup demo — look for the floating launcher") is visible
- [ ] Verify the CopilotPopup opens by default
- [ ] Verify the floating launcher bubble is visible in the corner

### 2. Chat Interaction

- [ ] Send "Say hi from the popup!" from the popup
- [ ] Verify the agent responds with a greeting
- [ ] Verify the chat input placeholder reads "Ask the popup anything..."

### 3. Error Handling

- [ ] Close and re-open the popup — chat state should persist
- [ ] Verify no console errors during normal usage

## Expected Results

- Popup opens automatically on page load
- Agent responds within 10 seconds
- No UI errors or broken layouts
