# QA: Chat Slots — CrewAI (Crews)

## Prerequisites
- Demo deployed; agent backend healthy.

## Test Steps

- [ ] Navigate to `/demos/chat-slots`.
- [ ] Verify the custom welcome screen with "Welcome to the Slots demo" is visible (`data-testid="custom-welcome-screen"`).
- [ ] Verify the indigo gradient card and "Custom Slot" tag are visible.
- [ ] Verify "Write a sonnet" and "Tell me a joke" suggestions are visible.
- [ ] Click "Write a sonnet" (or send a message).
- [ ] Verify the custom assistant-message card (`data-testid="custom-assistant-message"`) is used to wrap the assistant response — with an indigo border and "slot" badge.
- [ ] Verify the custom disclaimer (`data-testid="custom-disclaimer"`) is visible under the input.

## Expected Results
- All three slot overrides (welcomeScreen / input.disclaimer / messageView.assistantMessage) are visible.
