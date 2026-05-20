# QA: Chat Slots — Agno

## Prerequisites

- Demo deployed at `/demos/chat-slots`
- Agent backend healthy (`/api/health`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/chat-slots`
- [ ] Verify the custom welcome screen slot renders (`data-testid="custom-welcome-screen"`)
- [ ] Verify the heading "Welcome to the Slots demo" is visible
- [ ] Verify the "Custom Slot" badge is visible inside the welcome card

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Write a sonnet" suggestion pill renders
- [ ] Verify "Tell me a joke" suggestion pill renders
- [ ] Click "Tell me a joke"; verify an assistant bubble appears wrapped by `data-testid="custom-assistant-message"`

#### Custom Disclaimer Slot

- [ ] After the first assistant turn, verify `data-testid="custom-disclaimer"` is visible below the input

#### Persistence Across Turns

- [ ] Send a second message; verify at least two `data-testid="custom-assistant-message"` wrappers exist

### 3. Error Handling

- [ ] No uncaught console errors during the entire flow
