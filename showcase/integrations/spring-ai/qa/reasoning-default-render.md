# QA: Reasoning (Default Render) — Spring AI

## Prerequisites

- Spring AI backend is up

## Test Steps

- [ ] Navigate to `/demos/reasoning-default-render`
- [ ] Send a message
- [ ] Verify the page loads and chat responds normally

## Expected Results

- Zero-config reasoning: no `reasoningMessage` slot is registered
- If REASONING*MESSAGE*\* events are emitted, the built-in CopilotChatReasoningMessage renders a collapsible card
- If not (current Spring AI adapter default), the chat behaves as a normal chat
