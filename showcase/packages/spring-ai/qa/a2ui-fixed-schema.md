# QA: A2UI Fixed Schema — Spring AI

## Prerequisites
- Spring AI backend is up with A2uiFixedSchemaController mounted at `/a2ui-fixed-schema/run`

## Test Steps
- [ ] Navigate to `/demos/a2ui-fixed-schema`
- [ ] Click the "Find SFO → JFK" suggestion
- [ ] Verify a Flight Details card appears with SFO, arrow, JFK, UNITED badge, and a $289 price tag
- [ ] Click "Book flight"
- [ ] Verify the button transitions to "Booked ✓" (stateful ActionButton)

## Expected Results
- Spring tool `display_flight` returns the fixed schema + data model
- A2UI middleware on runtime forwards it as ACTIVITY_SNAPSHOT events
- Catalog pins Title/Airport/Arrow/AirlineBadge/PriceTag/Button to React renderers
