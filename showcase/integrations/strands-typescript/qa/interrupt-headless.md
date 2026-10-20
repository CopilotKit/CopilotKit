# QA: interrupt-headless

## Scope

Manual QA checklist for the `interrupt-headless` demo. Same interrupt
backend as `gen-ui-interrupt`; the picker is placed in the app surface via
`useInterrupt({ renderInChat: false })` instead of the chat.

## Happy path

- [ ] Navigate to `/demos/interrupt-headless`.
- [ ] Verify the app surface starts in its empty state.
- [ ] Ask to book a call and verify the picker mounts in the LEFT pane, not the
      chat.
- [ ] Pick a slot: the picker unmounts and the assistant confirms in chat.
- [ ] Repeat and dismiss the picker: the assistant must say it was NOT booked.

## Regression

- [ ] The picker never renders inside the chat transcript.
- [ ] The cancel path never narrates a confirmed booking.

## Known gaps

- Durable resume across a process restart needs a Strands `SessionManager`;
  this showcase pauses and resumes in one process.
