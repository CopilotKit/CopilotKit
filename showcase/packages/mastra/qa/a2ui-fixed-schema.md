# QA: A2UI Fixed Schema — Mastra

## Test Steps

- [ ] Navigate to `/demos/a2ui-fixed-schema`
- [ ] Verify the CopilotChat surface renders with "Find SFO → JFK" suggestion
- [ ] Click the suggestion; verify the agent calls `generate_a2ui` and a
  flight Card renders with:
  - Title "Flight found"
  - Airport codes SFO → JFK (with Arrow component between)
  - AirlineBadge pill showing "UNITED"
  - PriceTag showing "$289"
  - A "Book flight" button (stateful — becomes "Booked ✓" after click)

## Expected Results

- Fixed-schema catalog: `Title`, `Airport`, `Arrow`, `AirlineBadge`,
  `PriceTag`, and a stateful `Button` override
- Clicking the button transitions to the `Booked ✓` confirmation state
  without a round-trip to the agent
