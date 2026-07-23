# QA: Declarative Generative UI (A2UI — Fixed Schema) — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/a2ui-fixed-schema` on the dashboard host
- Agent backend is healthy; `OPENAI_API_KEY` is set on Railway; `LANGGRAPH_DEPLOYMENT_URL` points at a LangGraph deployment exposing the `a2ui_fixed` graph (registered as agent name `a2ui-fixed-schema` — see `src/app/api/copilotkit-a2ui-fixed-schema/route.ts`)
- Note: the demo source contains no `data-testid` attributes. Checks below rely on verbatim visible text, DOM structure, and the JSON schema at `src/agents/a2ui_schemas/flight_schema.json`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/a2ui-fixed-schema`; verify the page renders within 3s and a single `CopilotChat` pane is centered (max-width ~896px, rounded-2xl, full-height)
- [ ] Verify the chat is wired to `runtimeUrl="/api/copilotkit-a2ui-fixed-schema"` and `agent="a2ui-fixed-schema"` (DevTools → Network: sending a message hits that endpoint)
- [ ] Verify the single suggestion pill is visible with verbatim title "Find SFO → JFK" (message body: "Find me a flight from SFO to JFK on United for $289.")
- [ ] Send "Hello" and verify an assistant text response appears within 10s (no flight card for plain text)

### 2. Feature-Specific Checks

#### Schema Wiring (fixed catalog + `includeBasicCatalog`)

- [ ] DevTools → Network: after the first successful `display_flight` call, verify the response stream contains an `a2ui_operations` container with `catalogId: "copilotkit://flight-fixed-catalog"` (matches `CATALOG_ID` in `src/agents/a2ui_fixed.py` and `src/app/demos/a2ui-fixed-schema/a2ui/catalog.ts`)
- [ ] Verify the same container carries the full `FLIGHT_SCHEMA` component tree (12 nodes from `src/agents/a2ui_schemas/flight_schema.json`: `root`, `content`, `title`, `route`, `from`, `arrow`, `to`, `meta`, `airline`, `price`, `bookButton`, `bookButtonLabel`)

#### Search-Flights Prompt (`display_flight` tool → `flight_schema.json`)

- [ ] Click the "Find SFO → JFK" suggestion; within 20s verify a single flight card renders in-transcript assembled per `flight_schema.json`:
  - outer `Card` with a `Column` of children in this order: title row, route row, meta row, book button
  - `Title` node renders the literal text "Flight Details" (1.15rem / 600 weight, color `#010507`)
  - `route` row shows `Airport` "SFO" → `Arrow` (`→`, color `#AFAFB7`) → `Airport` "JFK" (both monospaced, 1.5rem, 600 weight, 0.05em letter-spacing)
  - `meta` row shows `AirlineBadge` "UNITED" (uppercase pill, lilac `#BEC2FF` border, 0.08em tracking) on the left and `PriceTag` "$289" (monospaced, color `#189370`, 1.1rem / 600 weight) on the right
  - `Button` renders full-width with label "Book flight" (black `#010507` background, white text, 12px radius)
- [ ] Verify all four data-model fields resolved correctly (origin=`SFO`, destination=`JFK`, airline=`United`, price=`$289`) — each is a `{ path: "/..." }` binding in the schema and must reach the DOM as a plain string via the `GenericBinder` (no literal `{path}` leak and no React error #31)

#### Book-Flight Button (inert — pure presentation)

- [ ] Verify the "Book flight" button is rendered with the schema-declared label and is clickable, but the click is a no-op: the agent is not invoked, no schema swap occurs, and the button does not transition to a "Booked" state. Schema-swap-on-action will be wired up once the Python SDK exposes `action_handlers=` on `a2ui.render` (see comment in `src/agents/a2ui_fixed.py`).

#### Follow-up Prompt (data-model refresh)

- [ ] Send "Find me a flight from LAX to ORD on Delta for $412."; within 20s verify the card updates in place with origin=`LAX`, destination=`ORD`, airline=`DELTA`, price=`$412` (same schema, new data model — proves the fixed-schema pattern: schema once, data streams)

### 3. Error Handling

- [ ] Send an empty message; verify it is a no-op (no user bubble, no assistant response)
- [ ] Send "What is the capital of France?"; verify the agent replies in plain text without invoking `display_flight` (no flight card rendered, no `a2ui_operations` in the response)
- [ ] DevTools → Console: walk through all flows above; verify no uncaught errors and specifically no React error #31 ("objects are not valid as a React child, found: object with keys {path}") — the `DynString` union in `a2ui/definitions.ts` is what prevents this, so a single occurrence is a regression

## Expected Results

- Chat loads within 3s; plain-text response within 10s; flight card renders within 20s of the search prompt
- `display_flight` is called exactly once per search prompt; result contains an `a2ui_operations` container with `catalogId: "copilotkit://flight-fixed-catalog"` and the full 12-node flight schema
- All custom renderers in `a2ui/renderers.tsx` (`Card`, `Title`, `Airport`, `Arrow`, `AirlineBadge`, `PriceTag`, `Button`) render at least once per search-flights run
- Clicking "Book flight" is a no-op (inert presentation button — see comment in `src/agents/a2ui_fixed.py`)
- No UI layout breaks, no `{path}` leak into the DOM, no uncaught console errors
