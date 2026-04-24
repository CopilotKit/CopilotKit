# QA: Agentic Chat (Reasoning) — Spring AI

## Prerequisites
- Spring AI backend is up

## Test Steps
- [ ] Navigate to `/demos/agentic-chat-reasoning`
- [ ] Send a message
- [ ] Verify the page loads and chat responds normally

## Expected Results
- Page demonstrates the `messageView.reasoningMessage` slot pattern
- If the `ag-ui:spring-ai` adapter emits REASONING_MESSAGE_* events, the custom amber-banner ReasoningBlock renders
- If not, the chat behaves as a normal chat (adapter-level limitation documented in PARITY_NOTES.md)
