# QA: Tool Rendering (OpenClaw)

Demo source: `src/app/demos/tool-rendering/page.tsx`
Route: `/demos/tool-rendering` · Agent: `tool-rendering`
Run against the real backend at `http://localhost:3119/demos/tool-rendering`.

Status: **supported** (in `manifest.yaml`), on the same forwarded-tools + event
relay path as frontend-tools, but **not yet on the verified-e2e list** in
`PARITY_NOTES.md` — see Caveats.

## What it exercises

Rendering tool calls as branded React cards in the chat transcript. The page
registers four **render-only** tool renderers with `useRenderTool` — no handler,
just a `render(props)` keyed on `{ parameters, result, status }` — plus a
wildcard catch-all via `useDefaultRenderTool`:

| Tool              | Renderer                 | Card testid            |
| ----------------- | ------------------------ | ---------------------- |
| `get_weather`     | `WeatherCard`            | `weather-card`         |
| `search_flights`  | `FlightListCard`         | `flights-card`         |
| `get_stock_price` | `StockCard`              | `stock-card`           |
| `roll_d20`        | `D20Card`                | `d20-card`             |
| `*` (anything)    | `CustomCatchallRenderer` | `custom-catchall-card` |

Unlike frontend-tools, these are **not** `useFrontendTool` tools — there is no
browser-side handler. In the canonical LangGraph reference they are
backend-owned tools; the frontend only draws them. OpenClaw is a single
stateless gateway with **no per-demo backend to execute them**, so the model
itself produces the tool call (and any narrated result) and the gateway relays
`TOOL_CALL_START/ARGS/END` (+ any `TOOL_CALL_RESULT`) over AG-UI. Each renderer
shows a loading state while `status !== "complete"`, then paints the result once
the run reports the call complete.

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy (per-demo agent names all map to the one OpenClaw endpoint).

## Manual steps

1. Open the demo. Confirm the centered, full-height `CopilotChat` renders and
   the five suggestion chips are visible: **Weather in SF**, **Find flights**,
   **Stock price**, **Roll a d20**, **Chain tools**.
2. Ask (or click **Weather in SF**): **"What's the weather in San Francisco?"**
   Expect a `get_weather` tool call rendered as a `WeatherCard`: a "Fetching
   weather..." loading state, then a card showing the city, a temperature in
   **°F**, conditions, humidity, and wind (mph). (This card is Fahrenheit-only —
   no Celsius, unlike some other integrations.)
3. Click **Find flights** (`SFO → JFK`). Expect a `search_flights` call rendered
   as a `FlightListCard`: three skeleton rows while "searching…", then an
   origin → destination header, a result count, and a list of flight rows.
4. Click **Stock price** (`AAPL`). Expect a `get_stock_price` call rendered as a
   `StockCard`: ticker, price, and a change percentage (green if ≥ 0, red if
   negative).
5. Click **Roll a d20**. Expect a `roll_d20` call rendered as a `D20Card` showing
   the rolled value; a value of 20 gets a "critical!" badge and a ring.
6. **Chain tools**: click the **Chain tools** chip (weather in Tokyo + flights
   SFO→Tokyo + roll a d20 in one turn). Confirm multiple cards render in the same
   turn, each keyed to its own tool call, without clobbering one another.
7. (Catch-all) Ask for a tool with no dedicated renderer (any other tool name the
   model emits). Confirm it falls through to the `CustomCatchallRenderer` — a
   generic card showing the tool name, a status badge
   (streaming / running / done), pretty-printed arguments, and the result JSON.

## Assertion bar

- The correct **branded** card renders per tool name (weather/flights/stock/d20),
  and unmatched tools land on the catch-all — not the wrong card, not raw text.
- Each card transitions from its loading state to a populated result once the
  tool call completes.
- In the chained turn, one card per tool call, all rendered coherently.
- No console errors and no broken layout during normal usage.

## Caveats

- **Result population depends on the gateway/model, not a backend tool.** These
  renderers key on `result`; with no per-demo executor, the branded fields fill
  only insofar as the model produces a tool result the gateway relays. If a call
  finishes without a structured result, cards may show a completed shell with
  `--`/empty fields rather than the fully-populated LangGraph-reference values.
  This is expected on the stateless gateway.
- **Not individually e2e-verified.** `PARITY_NOTES.md` lists this demo as
  supported via the same proven forwarded-tools + relay mechanism as
  frontend-tools, but tool-rendering is not on the verified-end-to-end list;
  aimock fixtures + Playwright coverage are being brought up to fleet parity.
- Values are not deterministic against the real backend — model output varies
  run to run. Deterministic values (e.g. the d20 sequence `[7, 14, 3, 19, 20]`,
  fixed stock prices) come from the aimock fixtures, not this manual path.
- The three sibling demos (`tool-rendering-default-catchall`,
  `tool-rendering-custom-catchall`, `tool-rendering-reasoning-chain`) exercise
  narrower slices of the same mechanism and share the pass-through agent.
