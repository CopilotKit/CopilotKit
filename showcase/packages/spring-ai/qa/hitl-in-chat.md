# QA: In-Chat HITL (hitl-in-chat) — Spring AI

## Prerequisites
- Demo is deployed and accessible

## Test Steps
- [ ] Navigate to `/demos/hitl-in-chat`
- [ ] Ask "Please book an intro call with the sales team"
- [ ] Verify a TimePickerCard renders inline in the chat (`data-testid="time-picker-card"`)
- [ ] Click a time slot
- [ ] Verify the agent acknowledges the booking with the chosen time

## Expected Results
- The useHumanInTheLoop card renders inside the chat and resolves back to the agent
