# QA: Declarative Generative UI (A2UI — Fixed Schema) — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/a2ui-fixed-schema` on the dashboard host
- Next.js host is healthy (`GET /api/health` → `{"status":"ok","integration":"claude-sdk-python"}`) and the Python backend is reachable (`GET /api/copilotkit` reports `agent_status: "reachable"`, which it derives by polling `${AGENT_URL}/health`)
- `ANTHROPIC_API_KEY` is set — this cell's model calls go to Anthropic, not OpenAI (`OPENAI_API_KEY` is in `.env.example` for the shared stack, but no code path in this demo reads it). `ANTHROPIC_MODEL` is optional; `.env.example` sets `claude-opus-4-8`, and `src/agents/a2ui_fixed.py` falls back to that same id
- `AGENT_URL` (default `http://localhost:8000`) points at the FastAPI agent server `src/agent_server.py`, which exposes `@app.post("/a2ui-fixed-schema")` → `run_a2ui_fixed_agent`. There is **no** LangGraph deployment and no graph registration in this integration
- Note: unlike the langgraph-python reference, the outer card here **does** carry a stable `data-testid="a2ui-fixed-card"` (see `src/app/demos/a2ui-fixed-schema/a2ui/renderers.tsx`). Everything else below relies on verbatim visible text, DOM structure, and the JSON schema at `src/agents/a2ui_schemas/flight_schema.json`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/a2ui-fixed-schema`; verify the page renders within 3s: a `max-w-4xl` column with `border-x border-neutral-200 bg-white` on a `bg-neutral-50` page, filling full viewport height, with the `CopilotChat` itself `rounded-2xl`
- [ ] Verify the chat is wired to `runtimeUrl="/api/copilotkit-a2ui-fixed-schema"` and `agent="a2ui-fixed-schema"` (DevTools → Network: sending a message hits that endpoint, not `/api/copilotkit`)
- [ ] Verify the single suggestion pill is visible with verbatim title "Find SFO → JFK" (message body: "Find me a flight from SFO to JFK on United for $289.")
- [ ] Send "Hello" and verify an assistant text response appears within 10s (no flight card for plain text)

### 2. Feature-Specific Checks

#### Schema Wiring (fixed catalog + `includeBasicCatalog`)

- [ ] DevTools → Network: after the first successful `display_flight` call, verify the tool result contains an `a2ui_operations` container whose `createSurface` carries `surfaceId: "flight-fixed-schema"` and `catalogId: "copilotkit://flight-fixed-catalog"` (matches `SURFACE_ID` / `CATALOG_ID` in `src/agents/a2ui_fixed.py` and `CATALOG_ID` in `src/app/demos/a2ui-fixed-schema/a2ui/catalog.ts`)
- [ ] Verify the same container's `updateComponents` carries the full `FLIGHT_SCHEMA` tree (12 nodes from `src/agents/a2ui_schemas/flight_schema.json`: `root`, `content`, `title`, `route`, `from`, `arrow`, `to`, `meta`, `airline`, `price`, `bookButton`, `bookButtonLabel`) and that `updateDataModel` writes `{origin, destination, airline, price}` at path `/`

#### Search-Flights Prompt (`display_flight` tool → `flight_schema.json`)

- [ ] Click the "Find SFO → JFK" suggestion; within 20s verify a single flight card renders in-transcript with `data-testid="a2ui-fixed-card"`, assembled per `flight_schema.json`:
  - outer `Card` (`max-w-md`, 20px padding) wrapping a `Column` of children in this order: title row, route row, meta row, book button
  - `Title` node renders the eyebrow "Itinerary" above the literal schema text "Flight Details", with an outline mono badge "1-stop · economy" on the right
  - `route` row shows `Airport` "SFO" → `Arrow` (an SVG chevron flanked by two hairline separators) → `Airport` "JFK" (both monospaced, `text-2xl`, semibold, wide tracking)
  - `meta` row shows `AirlineBadge` "UNITED" (secondary pill, uppercase, `0.08em` tracking) on the left and `PriceTag` — the eyebrow "Total" followed by monospaced "$289" — on the right
  - `Button` renders full-width with label "Book flight"
- [ ] Verify all four data-model fields resolved correctly (origin=`SFO`, destination=`JFK`, airline=`United`, price=`$289`) — each is a `{ path: "/..." }` binding in the schema and must reach the DOM as a plain string via the binder (no literal `{path}` leak and no React error #31)

#### Book-Flight Button (inert — pure presentation)

- [ ] Verify the "Book flight" button renders the schema-declared label and is clickable, but the click is a no-op: the agent is not invoked, no schema swap occurs, and the button does not transition to a "Booked" state. The schema declares an `action` (`book_flight`) purely for fidelity; the `Button` renderer in `a2ui/renderers.tsx` deliberately drops it — schema-swap-on-action waits on the Python SDK exposing `action_handlers=` on `a2ui.render` (see the `Button` comment in `a2ui/renderers.tsx`). `src/agents/a2ui_schemas/booked_schema.json` ships alongside but is not loaded by any code path

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
- Clicking "Book flight" is a no-op (inert presentation button)
- No UI layout breaks, no `{path}` leak into the DOM, no uncaught console errors
