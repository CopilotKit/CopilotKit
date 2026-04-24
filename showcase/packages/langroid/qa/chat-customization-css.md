# QA: Chat Customization (CSS) — Langroid

## Prerequisites

- Demo is deployed
- Agent backend reachable via /api/health

## Test Steps

- [ ] Navigate to /demos/chat-customization-css
- [ ] Verify the scoped wrapper `.chat-css-demo-scope` renders (DOM inspector)
- [ ] Verify user bubble shows pink gradient (hot pink -> magenta)
- [ ] Verify assistant bubble shows amber monospace style
- [ ] Verify the textarea input has a dashed pink border
- [ ] Send a message; verify styled reply appears

## Expected Results

- Custom theme CSS applies only inside the demo wrapper
- Chat functions normally
