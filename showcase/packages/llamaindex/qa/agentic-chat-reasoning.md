# QA: Agentic Chat (Reasoning) — LlamaIndex

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the agentic-chat-reasoning demo page
- [ ] Verify the chat interface loads with placeholder "Type a message"
- [ ] Send a basic question such as "Why is the sky blue?"
- [ ] Verify the agent responds with a text answer

### 2. Reasoning Slot Override

- [ ] Ask a question that encourages step-by-step thinking
- [ ] Verify the custom reasoning block (`data-testid="reasoning-block"`) is
      visible in the chat when reasoning tokens surface
- [ ] Verify the "Reasoning" badge is shown
- [ ] Verify the body of the reasoning block is italic

### 3. Regression

- [ ] Multiple turns preserve conversation history
- [ ] Reasoning block disappears when starting a fresh conversation
