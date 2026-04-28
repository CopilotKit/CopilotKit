# QA: A2UI - Fixed Schema — CrewAI (Crews)

- [ ] Navigate to `/demos/a2ui-fixed-schema`.
- [ ] Verify the page root (`data-testid="a2ui-fixed-schema-root"`) renders.
- [ ] Click the "Find SFO → JFK" suggestion pill.
- [ ] Verify a flight card renders with "SFO → JFK", the airline "United
      Airlines", and the price "$289".
- [ ] Click the "Book flight" button on the card; verify it switches to
      "Booked ✓" (ActionButton with local state — no backend round-trip).
- [ ] Ask a free-form flight question ("flight from LAX to BOS on Delta
      for $320") and verify the card updates with the new data model.
