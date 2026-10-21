# QA: Tool Rendering (Reasoning Chain) — Google Antigravity

> Testing-kind demo: like the reference package, this is a short checklist rather than a full manual sheet.

## Prerequisites

- Demo is deployed and accessible at `/demos/tool-rendering-reasoning-chain` on the dashboard host
- Agent backend is healthy (`/api/health` or `/api/copilotkit` GET); `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) is set (the Go harness calls Gemini itself; `GOOGLE_GEMINI_BASE_URL` points it at aimock in tests)
- The agent server (`src/agent_server.py`) mounts `tool-rendering-reasoning-chain` at `/tool-rendering-reasoning-chain`, bound in `src/agents/registry.py` to `tool_rendering_reasoning_chain_agent()` from `src/agents/tool_rendering_reasoning_chain.py` (reasoning model; server tools `get_weather`, `search_flights`, `get_stock_price`, `roll_dice`); the page talks to it through `/api/copilotkit`
- The tools run server-side: the adapter dispatches each call and emits its `TOOL_CALL_RESULT`. Reasoning arrives as `REASONING_*` events, and a tool call can arrive while a reasoning message is still open, which is expected. In fixture runs every tool leg carries `reasoning`, so each turn mounts at least one reasoning block.

## Test Steps

- [ ] Navigate to `/demos/tool-rendering-reasoning-chain`; verify three suggestion pills: "Compare two stocks", "Chain of dice rolls", "Flights + destination weather"
- [ ] Click "Compare two stocks" (sends "Compare AAPL and MSFT stocks for me."); verify at least one `data-testid="reasoning-block"` renders, then two `data-testid="custom-catchall-card"` cards with `data-tool-name="get_stock_price"`, then a text summary
- [ ] Click "Chain of dice rolls"; verify reasoning plus two `custom-catchall-card` cards with `data-tool-name="roll_dice"` (different `sides`), each showing a result
- [ ] Click "Flights + destination weather" (sends "Find flights from SFO to JFK and show me the weather there."); verify reasoning, a `data-testid="flight-list-card"` with `flight-origin` "SFO", `flight-destination` "JFK" and `flight-row` entries, then a `data-testid="weather-card"` for the destination
- [ ] Verify each reasoning block uses the custom `ReasoningBlock` slot ("Reasoning" pill, "Thinking…" while streaming, "Agent reasoning" when done)
- [ ] Verify every tool card reaches its complete state with results filled in (no card stuck loading)
- [ ] Verify DevTools → Console shows no uncaught errors or AG-UI event-verification errors

## Expected Results

- Page loads without errors
- Reasoning blocks and tool cards render in one sequential chain in the same message view, each tool matched to its renderer (`WeatherCard`, `FlightListCard`, or the custom catch-all)
