# QA: Headless Chat (Complete) (OpenClaw)

Demo source: `src/app/demos/headless-complete/page.tsx` (+ `chat/`, `hooks/`, `tools/`, `attachments/`)
Route: `/demos/headless-complete` · Agent: `headless-complete` · Runtime: `/api/copilotkit-headless-complete`

## What it exercises

The full headless surface, hand-rolled without `<CopilotChat>`: a custom Card
shell (header + reset), message list, suggestion bar, and composer with
attachments. Every render surface CopilotKit exposes is wired here:

- `useFrontendTool` × 3 — `get_weather` → WeatherCard, `get_stock_price` →
  StockCard, `get_revenue_chart` → ChartCard. In the claude-sdk reference these
  were backend tools; against the OpenClaw gateway (a stateless pass-through
  with no per-demo backend) they are **frontend-forwarded**: the schema goes
  over AG-UI in `RunAgentInput.tools`, ag-ui hands it to OpenClaw as a
  caller-provided **client tool**, the model calls it, and the local handler
  produces the (deterministic mock) result the model then narrates.
- `useComponent` — `highlight_note` (UI-only frontend tool → sticky-note card).
- `useDefaultRenderTool` — wildcard catch-all (GenericToolCard) for any tool
  without a dedicated renderer.
- `useConfigureSuggestions` + `useSuggestions` (SuggestionBar) — 4 pills.
- `useAttachments` — image + PDF, base64-inline, in the custom composer.
- `useRenderToolCall` + `useRenderActivityMessage` — inline tool-call cards and
  the activity path, driven from the hand-rolled `MessageList`.

## Manual steps

1. Open the demo. Confirm the header reads **"Headless Chat"** with subtext
   "Built without &lt;CopilotChat&gt; — full headless surface.", and the empty
   state shows heading **"The full headless surface"** with four clickable
   sample-prompt badges. There is no `.copilotKitChat` element — the surface is
   truly headless.
2. **Weather** — click the "What's the weather in Tokyo?" pill (or type it).
   Expect a `[data-testid="headless-weather-card"]` card for Tokyo with a
   condition string and a temperature; the assistant narrates the result.
3. **Stock** — send "What's the price of AAPL right now?". Expect a
   `[data-testid="headless-stock-card"]` card with ticker AAPL, a `$` price and
   a signed `%` change.
4. **Highlight** — send "Highlight this note for me: 'ship the demo on
   Friday'.". Expect a `[data-testid="headless-highlight-card"]` note in the
   yellow variant with the verbatim text "ship the demo on Friday".
5. **Revenue chart** — send "Show me a chart of revenue over the last six
   months.". Expect a `[data-testid="headless-revenue-chart"]` bar chart titled
   "Quarterly Revenue" with quarter labels Q1–Q4.
6. **Catch-all** — if the agent calls any tool without a dedicated renderer, it
   surfaces via GenericToolCard rather than being dropped.
7. **Suggestions** — after the first message, the SuggestionBar shows four pills
   (Weather / Stock price / Highlight a note / Revenue chart); each dispatches
   its message.
8. **Attachments** — click the paperclip (or drag/drop) and attach an image or
   PDF; confirm a chip renders in the composer and, after send, on the user
   bubble.
9. **Reset** — click the header reset button; confirm any in-flight run aborts
   and the transcript clears back to the empty state.

## Assertion bar

- Each request produces exactly one tool-call sequence and one rendered card
  (no duplicate render); the card promotes from running → complete when the
  tool result arrives.
- The full generative-UI weave (assistant text + per-tool cards + catch-all)
  is reconstructed **without** `<CopilotChat>`, through the hand-rolled
  MessageList.
- Send is disabled on an empty composer (Enter is a no-op); while the agent is
  running the placeholder switches to "Agent is responding..." and a second
  Enter cannot start a duplicate run (`if (agent.isRunning) return;`).
- No uncaught console errors during any flow above.

## Known caveats

- Tool data is **deterministic mock data**, not live — the WeatherCard renders
  the mock temperature with a `°F` suffix even though the mock value is in a
  Celsius-like range (e.g. "22°F"); narration wording comes from the real
  backend model and is not fixed, so assert on the card fields and testids, not
  on exact assistant prose.
- The empty-state sample badges use slightly different wording than the
  post-first-message SuggestionBar pills (e.g. "What's AAPL trading at?" vs the
  pill's "What's the price of AAPL right now?"); both trigger the same tools.
- The activity path (`useRenderActivityMessage`, e.g. an Excalidraw MCP-apps
  iframe) is wired in the frontend, but this route does **not** attach an MCP
  server, so an activity message is not expected to fire here. This is a code
  path present for parity, not an exercised flow on this demo.

## Protocol-level check (no browser)

Inside the running container, POST a `RunAgentInput` carrying the
`get_weather` frontend tool to `http://127.0.0.1:8000/v1/ag-ui/operator`
(Bearer gateway token, `Accept: text/event-stream`) with a "weather in Tokyo"
message, and confirm the SSE contains a single `TOOL_CALL_START` for
`get_weather` with `{ location: "Tokyo" }`, then `RUN_FINISHED`.
