# QA: Reasoning (Default Render) — LlamaIndex

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the reasoning-default-render demo page
- [ ] Verify the chat interface loads with placeholder "Type a message"
- [ ] Send a basic question such as "Explain briefly: why does ice float?"
- [ ] Verify the agent responds with a text answer

### 2. Built-in Reasoning Slot

- [ ] Verify the default CopilotChatReasoningMessage renders (when reasoning
  tokens surface) as a collapsible card
- [ ] Verify the card can be expanded/collapsed
- [ ] Confirm no custom reasoning block is used (page passes no slot override)

### 3. Regression

- [ ] Multiple turns preserve conversation history
- [ ] Default reasoning card re-collapses between messages
