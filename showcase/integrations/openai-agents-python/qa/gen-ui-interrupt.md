# QA: gen-ui-interrupt

## Scope

Manual QA checklist for the `gen-ui-interrupt` demo. The backend tool is
marked `needs_approval`, so the Agents SDK pauses the run and the backend ends
it with an AG-UI interrupt; the frontend renders the time picker inline in the
chat through `useInterrupt`.

## Happy path

- [ ] Navigate to `/demos/gen-ui-interrupt`.
- [ ] Ask to book a call.
- [ ] Verify the time picker renders inline in the transcript.
- [ ] Pick a slot and verify the card shows the picked state, then the assistant
      confirms the booking.
- [ ] Repeat and use "None of these work": the assistant must say it was NOT
      booked.

## Regression

- [ ] A second request in the same thread pauses again (the resumed interrupt
      must not stay pending).
- [ ] The cancel path never narrates a confirmed booking.
- [ ] Ask to book, then type a new message instead of picking: the agent answers
      the new message without an error (the abandoned call is closed).

## Known gaps

- Nothing is kept on the server between the pause and the resume: the paused
  call lives in the conversation the page holds, so a backend restart in
  between does not lose it. The resumed tool runs outside the SDK's run loop,
  so tool guardrails and run hooks do not see that one call.
