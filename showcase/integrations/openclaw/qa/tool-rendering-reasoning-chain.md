# QA: Tool Rendering — Reasoning Chain (OpenClaw)

Demo source: `src/app/demos/tool-rendering-reasoning-chain/page.tsx`
Route: `/demos/tool-rendering-reasoning-chain` · Agent: `tool-rendering-reasoning-chain`
Runtime: `/api/copilotkit-reasoning` (shared with `reasoning-default` / `reasoning-custom`).
Run against the real backend at `http://localhost:3119/demos/tool-rendering-reasoning-chain`.

Status: **supported with a known gap** — the individual pieces (custom
reasoning slot, per-tool renderers, wildcard catch-all) all work, but
reasoning co-emitted _inside the same turn_ as a tool call depends on
additional ag-ui support that is not yet wired (see Caveats and
`PARITY_NOTES.md`).

## What it exercises

One cell that composes three rendering patterns over a single OpenClaw run:

- A custom **reasoning slot** — `ReasoningBlock` passed as
  `messageView.reasoningMessage` on `CopilotChat`. Reasoning tokens stream in
  from the gateway's `REASONING_MESSAGE_*` events (reasoning stream mode is
  configured on the gateway) and render in this branded block.
- Two **typed per-tool renderers** via `useRenderTool`:
  `get_weather` → `WeatherCard`, `search_flights` → `FlightListCard`.
- A **wildcard catch-all** via `useDefaultRenderTool` → `CustomCatchallRenderer`
  for any other tool the model calls (e.g. `get_stock_price`, `roll_dice`).

These tools are **render-only**: they carry no `useFrontendTool` handler. The
schema rides over AG-UI in `RunAgentInput.tools`, the ag-ui adapter hands it
to OpenClaw as a caller-provided client tool, and the model both calls the tool
and produces the result JSON that the card renders. There is no per-demo backend
— OpenClaw is a single stateless gateway, so all demo-specific behaviour is
frontend + gateway relay.

## Prerequisites

- Stack is up; demo reachable at the URL above.
- Gateway is healthy and configured for reasoning stream mode + a
  reasoning-capable model input.

## Manual steps

1. Open the demo. Confirm the chat renders and three suggestion chips appear:
   **Compare two stocks**, **Chain of dice rolls**, **Flights + destination
   weather**.
2. Click **Compare two stocks** (or ask: _"Compare AAPL and MSFT stocks for
   me."_). Expect a sequence of `get_stock_price` tool calls, each rendered by
   the **catch-all card** (`data-testid="custom-catchall-card"`) showing the
   tool name, arguments, a status badge (streaming → running → done), and the
   result JSON.
3. Click **Flights + destination weather** (or ask: _"Find flights from SFO to
   JFK and show me the weather there."_). Expect:
   - a `search_flights` call rendered by the **FlightListCard**
     (`data-testid="flight-list-card"`) — origin → destination header and a
     list of flight rows;
   - a `get_weather` call rendered by the **WeatherCard**
     (`data-testid="weather-card"`) — city, conditions, temperature, humidity,
     wind.
4. Confirm each card shows a **loading state** while the tool is in progress
   (skeleton rows / "Fetching weather…") and fills in once the result arrives.
5. Confirm any **reasoning** the model emits renders in the `ReasoningBlock`
   (`data-testid="reasoning-block"`) with the "Reasoning" pill — "Thinking…"
   while streaming, then the reasoning text.

## Assertion bar

- Each tool call is matched to the correct renderer: `get_weather` → WeatherCard,
  `search_flights` → FlightListCard, everything else → catch-all card.
- Cards transition from loading to populated (not stuck loading, not rendered
  only after the whole turn).
- Reasoning tokens land in the custom `ReasoningBlock`, not the default panel.
- No duplicate cards for a single tool call.

## Caveats

- **Known gap — reasoning + tools in one turn.** The runtime route comment
  (`src/app/api/copilotkit-reasoning/route.ts`) notes the reasoning-chain
  variant (reasoning co-emitted with a tool call) depends on additional ag-ui
  support. In practice you may see reasoning **or** tool cards render cleanly,
  but a tightly interleaved reasoning-then-tool chain within the same turn is
  not guaranteed. Verify the current gateway behaviour before signing off; if
  the chain does not interleave, that is the documented gap, not a demo bug.
- **Model-driven results.** The tool cards render whatever result JSON the model
  produces (there is no backend tool implementation). Shapes are coerced by
  `parseJsonResult`, which returns `{}` on missing/unparseable results — a card
  with all "--" placeholders usually means the model returned nothing parseable,
  not a render failure.
- This cell has not been individually e2e-verified at the gateway level; it
  relies on the same reasoning-emission and frontend-forwarded-tool mechanisms
  proven by `reasoning-*` and `frontend-tools`.
