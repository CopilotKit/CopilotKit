# QA: Chat Customization (CSS) — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/chat-customization-css`
- [ ] Verify the chat loads inside the `.chat-css-demo-scope` wrapper
- [ ] Send a basic message
- [ ] Verify the agent responds

### 2. Feature-Specific Checks

#### Theme Application

- [ ] Verify user message bubbles render with the hot-pink gradient
- [ ] Verify assistant message bubbles render with the amber background and monospace font
- [ ] Verify the input area shows a dashed pink border
- [ ] Verify the input placeholder color is pink italic

#### Variable Overrides

- [ ] Inspect the `.chat-css-demo-scope` element and verify CopilotKit CSS variables are overridden (e.g. `--copilot-kit-primary-color: #ff006e`)
- [ ] Verify the customization does not leak outside the scoped container

### 3. Error Handling

- [ ] Verify no console errors during normal usage

## Expected Results

- Page loads within 3 seconds
- Theme is applied only inside `.chat-css-demo-scope`
- Agent responds within 10 seconds
