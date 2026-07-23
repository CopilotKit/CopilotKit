# QA: Chat Slots — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/chat-slots`
- [ ] Verify the custom welcome screen (`data-testid="custom-welcome-screen"`) is visible
- [ ] Verify the welcome card shows "Welcome to the Slots demo"
- [ ] Verify the suggestion pills ("Write a sonnet", "Tell me a joke") are visible

### 2. Feature-Specific Checks

#### Welcome Slot

- [ ] Confirm the gradient welcome card wraps the default input + suggestions
- [ ] Verify the "Custom Slot" pill is visible above the headline

#### Disclaimer Slot

- [ ] After sending a message, verify the custom disclaimer (`data-testid="custom-disclaimer"`) is visible
- [ ] Verify the disclaimer text contains "Custom disclaimer injected via"

#### Assistant Message Slot

- [ ] Send a basic message
- [ ] Wait for the agent response
- [ ] Verify the assistant message is wrapped by the custom slot (`data-testid="custom-assistant-message"`)
- [ ] Verify the "slot" badge is visible on the assistant message

### 3. Error Handling

- [ ] Verify no console errors during normal usage

## Expected Results

- Page loads within 3 seconds
- All three slot overrides (welcome, disclaimer, assistantMessage) render as custom components
- Agent responds within 10 seconds
