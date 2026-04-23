# Declarative Generative UI (A2UI — Fixed Schema)

## What This Demo Shows

A fixed A2UI layout authored ahead of time as JSON — the agent only streams data into its slots, never the shape of the UI.

- **Pre-authored schema**: `flight_schema.json` defines a flight card assembled from `Card > Column > [Title, Row[Airport, Arrow, Airport], AirlineBadge, PriceTag, Button]`
- **Data-only updates**: the `display_flight` tool supplies `{ origin, destination, airline, price }`, which path-bound props resolve at render time
- **Stateful button override**: the catalog's `Button` renderer transitions to a "Booked" confirmation on click

## How to Interact

Click the suggestion chip, or try:

- "Find me a flight from SFO to JFK on United for $289."
- "Show a flight from LAX to Tokyo on ANA for $820."
- "I need a flight from Berlin to London on Lufthansa for $140."

The agent calls `display_flight`, the card renders, and "Book flight" flips to "Booked" when clicked.

## Technical Details

- Frontend wires the catalog via `<CopilotKit a2ui={{ catalog: fixedCatalog }}>`, built with `createCatalog(flightDefinitions, flightRenderers, { includeBasicCatalog: true })`.
- `runtimeUrl="/api/copilotkit-a2ui-fixed-schema"` and `agent="a2ui-fixed-schema"` point at `src/agents/a2ui_fixed.py`. The agent loads `FLIGHT_SCHEMA` via `a2ui.load_schema(...)` at import time.
- `display_flight` returns `a2ui.render(operations=[create_surface, update_components(FLIGHT_SCHEMA), update_data_model({...})])` — components never change across calls, only the data model does.
- Definitions use a `DynString = z.union([z.string(), z.object({ path: z.string() })])` so A2UI's `GenericBinder` resolves path-bound props (e.g. `{ path: "/origin" }`) to live values at render time.
