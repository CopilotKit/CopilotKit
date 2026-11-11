# QA: gen-ui-interrupt

## Scope

Manual QA checklist for the `gen-ui-interrupt` demo. The backend tool
pauses for the user's pick (AI SDK `needsApproval`, which
`@ag-ui/cloudflare-agents` turns into an AG-UI interrupt); the frontend renders
the time picker inline in the chat through `useInterrupt`. The Interrupt agent
turns the picked slot into the approval (`src/agent/scheduling.ts`).

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

- The picker shows the generic topic ("a call"): the adapter's approval
  interrupt carries the call's input under `metadata.tool_input`, not under
  `metadata.reason`, which is where the shared page reads the topic.
