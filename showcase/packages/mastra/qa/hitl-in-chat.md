# QA: HITL In-Chat (useHumanInTheLoop) — Mastra

## Test Steps

- [ ] Navigate to `/demos/hitl-in-chat`
- [ ] Click suggestion "Book a call with sales"
- [ ] Verify the `TimePickerCard` renders inline in the chat
- [ ] Select a time slot and submit
- [ ] Verify the agent acknowledges the chosen slot

## Expected Results

- `useHumanInTheLoop` renders its card inline with the chat message flow
- Picker submission resolves back to the agent
