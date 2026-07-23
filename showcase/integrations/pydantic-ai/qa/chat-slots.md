# QA: Chat Slots — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the chat-slots demo page
- [ ] Verify the custom welcome screen renders (`data-testid="custom-welcome-screen"`)
- [ ] Verify the gradient "Welcome to the Slots demo" card is visible
- [ ] Verify the custom disclaimer renders (`data-testid="custom-disclaimer"`)

### 2. Chat Interaction

- [ ] Send "Write a short joke"
- [ ] Verify the custom assistant message wrapper renders (`data-testid="custom-assistant-message"`)
- [ ] Verify the indigo-tinted card wraps the assistant reply with the corner "slot" badge

### 3. Error Handling

- [ ] Verify no console errors during normal usage

## Expected Results

- All three slot overrides (welcome, disclaimer, assistant message) render
- Agent responds within 10 seconds
- No UI errors or broken layouts
