# QA: gen-ui-interrupt

## Scope

Manual QA checklist for the `gen-ui-interrupt` demo. The backend tool
pauses itself with Strands' native interrupt; the frontend renders the time
picker inline in the chat through `useInterrupt`.

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

## Known gaps

- Durable resume across a process restart needs a Strands `SessionManager`;
  this showcase pauses and resumes in one process.
