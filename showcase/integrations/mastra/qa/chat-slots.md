# QA: Chat Slots — Mastra

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy

## Test Steps

- [ ] Navigate to `/demos/chat-slots`
- [ ] Verify the custom welcome screen renders (`data-testid="custom-welcome-screen"`)
- [ ] Verify the custom disclaimer is visible below the input (`data-testid="custom-disclaimer"`)
- [ ] Send any message
- [ ] Verify assistant response is wrapped in `data-testid="custom-assistant-message"`

## Expected Results

- Welcome screen has a gradient card badge "Custom Slot"
- Disclaimer shows with "slot" label
- Assistant message has an indigo tint + "slot" badge corner
