# QA: State Streaming — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the shared-state-streaming demo page
- [ ] Verify the chat interface loads with title "State Streaming"
- [ ] Verify the chat input placeholder "Type a message..." is visible
- [ ] Send a basic message (e.g. "Hello! What can you do?")
- [ ] Verify the agent responds

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Get started" suggestion button is visible

#### Note: Stub Demo

> **Status: Stub** — This demo is currently a stub (TODO: implement)

- [ ] Verify the basic CopilotChat loads and accepts messages
- [ ] Verify the agent responds to messages
- [ ] No custom UI components are expected beyond the chat interface

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results

- Chat loads within 3 seconds
- Agent responds within 10 seconds
- No UI errors or broken layouts
