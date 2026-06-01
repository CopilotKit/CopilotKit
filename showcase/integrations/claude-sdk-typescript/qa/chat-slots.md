# QA: Chat Customization (Slots) — Claude Agent SDK (TypeScript)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy

## Test Steps

- [ ] Navigate to /demos/chat-slots
- [ ] Verify the custom welcome screen renders on first load
- [ ] Verify the custom disclaimer below the input is visible
- [ ] Send a message and verify assistant messages use the custom assistant-message slot
- [ ] Verify no console errors

## Expected Results

- All three slot components (welcome, disclaimer, assistant message) render with custom styling
- Chat exchange works identically to the default chat
