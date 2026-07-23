# QA: Chat Customization (CSS) — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the chat-customization-css demo page
- [ ] Verify the chat is wrapped in `.chat-css-demo-scope`
- [ ] Verify the background is warm cream (#fff8f0)
- [ ] Verify the chat input uses a dashed pink border

### 2. Chat Interaction

- [ ] Send a message
- [ ] Verify the user message bubble is hot pink with bold white serif text
- [ ] Verify the assistant message bubble is amber with dark monospace text
- [ ] Verify markdown content inherits the themed fonts and colors

### 3. Error Handling

- [ ] Verify no CSS leaks outside `.chat-css-demo-scope`
- [ ] Verify no console errors during normal usage

## Expected Results

- All visual overrides scoped to the demo
- Agent responds within 10 seconds
- No layout breakage from custom CSS
