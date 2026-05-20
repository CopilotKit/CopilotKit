# QA: Frontend Tools — Agno

## Prerequisites

- Demo deployed at `/demos/frontend-tools`
- Agent backend healthy

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/frontend-tools`
- [ ] Verify the chat renders with placeholder "Type a message"
- [ ] Verify `data-testid="background-container"` is visible with the default background

### 2. Feature-Specific Checks

- [ ] Ask "Change the background to a blue-to-purple gradient"
- [ ] Verify the `change_background` frontend tool is invoked and the background-container style changes

### 3. Error Handling

- [ ] No uncaught console errors
