# QA: Chat Customization (CSS) — Spring AI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

- [ ] Navigate to `/demos/chat-customization-css`
- [ ] Verify the chat renders inside the scoped `.chat-css-demo-scope` wrapper
- [ ] Verify user messages have the hot-pink gradient bubble style
- [ ] Verify assistant messages have the amber boxy monospace style
- [ ] Send a message and verify both bubble styles render correctly

## Expected Results

- Chat loads within 3 seconds
- Themed styles only apply inside the demo scope (no global leak)
