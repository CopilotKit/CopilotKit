# QA: Declarative Generative UI (A2UI — Fixed Schema) (OpenClaw)

Demo source: `src/app/demos/a2ui-fixed-schema/page.tsx`
Route: `/demos/a2ui-fixed-schema` · Agent: `a2ui-fixed-schema`

## What it exercises

Declarative generative UI where the component **catalog is fixed on the frontend**
and the agent streams operations that populate it. The page wires a constrained
catalog (`./a2ui/catalog.ts`, `catalogId: "copilotkit://flight-fixed-catalog"`,
`includeBasicCatalog: true`) into `<CopilotKit a2ui={{ catalog }}>`, so the model
can only compose components the catalog declares: the flight-specific custom
components (`Card`, `Title`, `Airport`, `Arrow`, `AirlineBadge`, `PriceTag`,
`Button`) plus the basic catalog (Column, Row, Text, …).

OpenClaw difference from the LangGraph reference: the gateway is a stateless
pass-through with no backend `display_flight` tool. Instead the route
(`api/copilotkit-a2ui-fixed-schema/route.ts`) lets the A2UI runtime middleware
inject its generic **`render_a2ui`** tool (default `injectA2UITool: true`); the
gateway forwards that tool to the model and relays its `a2ui_operations` back over
AG-UI. So the flight card is **generated into a fixed catalog** rather than
data-only-streamed into a backend-owned schema — the "fixed schema" character is
enforced entirely by the frontend catalog.

## Manual steps

Run against the real backend at `http://localhost:3119/demos/a2ui-fixed-schema`.

1. Open the demo. Confirm a single centered chat pane renders and the one
   suggestion pill **"Find SFO → JFK"** is visible.
2. Click the suggestion (or send: **"Find me a flight from SFO to JFK on United
   for $289."**).
3. Expect: the model calls `render_a2ui`, and a flight card renders in-transcript,
   assembled from the fixed catalog:
   - Header row: "ITINERARY" eyebrow above a title, with a "1-stop · economy"
     mono badge on the right.
   - Route row: **SFO** → (arrow) → **JFK** in large monospace.
   - "UNITED" airline pill and a "Total $289" price.
   - A full-width **"Book flight"** button.
4. Confirm all four data values resolved from the model's operations (origin SFO,
   destination JFK, airline UNITED, price $289) — no literal `{path}` text leaks
   into the card.
5. Send a plain message (e.g. **"Hello"**) and confirm a normal text reply with no
   flight card.

## Assertion bar

- A flight card renders and is populated with the requested values (not just a
  "done" message).
- Only catalog components appear — the fixed catalog is what constrains output.
- No `{path}` object leaks into the DOM and no React error #31 in the console
  (the `DynString` union in `a2ui/definitions.ts` is what prevents this; a single
  occurrence is a regression).

## Known caveats

- **"Book flight" is inert.** The catalog declares an `action` on the button for
  visual fidelity, but the renderer just shows the label — clicking is a no-op (no
  agent invocation, no "Booked" state). See the note in `a2ui/renderers.tsx`; a
  real handler waits on the Python SDK exposing `action_handlers=` on
  `a2ui.render`.
- The card's non-data chrome ("ITINERARY", "1-stop · economy", "Total") is
  **hardcoded in the renderers**, not model-supplied — only SFO/JFK/UNITED/$289
  come from the model.
- Card **content is model-generated**, so exact wording/formatting can vary run to
  run; assert on the structure and the four data values, not verbatim strings.
- OpenClaw has no per-demo backend graph — this demo shares the single stateless
  gateway endpoint. Per-demo behavioural e2e coverage for A2UI is still being
  brought to fleet parity (see `PARITY_NOTES.md`); the `render_a2ui` relay itself
  is gateway-verified.

## Protocol-level check (no browser)

The A2UI middleware runs in the Next.js runtime, so the tool the model sees is
`render_a2ui` forwarded over AG-UI to the gateway. Sending the search prompt to
`/api/copilotkit-a2ui-fixed-schema` should produce an SSE stream whose tool call
is `render_a2ui` carrying `a2ui_operations` for the fixed catalog
(`catalogId: "copilotkit://flight-fixed-catalog"`), followed by `RUN_FINISHED`.
