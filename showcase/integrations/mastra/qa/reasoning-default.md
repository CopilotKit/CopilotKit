# QA: Reasoning (Default Render) — Mastra

## Test Steps

- [ ] Navigate to `/demos/reasoning-default-render`
- [ ] Ask a reasoning-prone question
- [ ] If the model emits reasoning tokens, verify the built-in `CopilotChatReasoningMessage` collapsible card renders

## Expected Results

- No custom `reasoningMessage` slot is supplied by the page
- Built-in UI handles the reasoning output

## Known Limitation

Same as `agentic-chat-reasoning`: depends on the underlying LLM emitting reasoning tokens.
