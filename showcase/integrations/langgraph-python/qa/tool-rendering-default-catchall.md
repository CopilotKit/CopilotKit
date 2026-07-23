# QA: Tool Rendering (Default Catch-all) — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- Agent slug `tool-rendering-default-catchall` is registered at `/api/copilotkit`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the `tool-rendering-default-catchall` demo page
- [ ] Verify the chat interface loads in a centered full-height layout (max-width 4xl, `rounded-2xl`)
- [ ] Verify the chat input placeholder "Type a message" is visible
- [ ] Send a basic message (e.g. "Hi")
- [ ] Verify the agent responds with a text message

### 2. Feature-Specific Checks — Built-in Default Tool-Call UI

The frontend calls `useDefaultRenderTool()` with NO config — it registers CopilotKit's package-provided `DefaultToolCallRenderer` as the `*` wildcard. The frontend adds ZERO custom per-tool or custom wildcard renderers. Every tool call must paint via this one built-in card.

#### Suggestions

- [ ] Verify "Weather in SF" suggestion pill is visible
- [ ] Verify "Find flights" suggestion pill is visible
- [ ] Verify "Roll a d20" suggestion pill is visible
- [ ] Click a suggestion and verify it either populates the input or sends the message

#### `get_weather` renders via the built-in default card

- [ ] Click the "Weather in SF" suggestion (or type "What's the weather in San Francisco?")
- [ ] Verify a default tool-call card appears with the tool name `get_weather` visible
- [ ] Verify a status pill transitions through `Running` and lands on `Done`
- [ ] Expand the card's "Arguments" section and verify it shows `{ "location": "San Francisco" }` (or similar)
- [ ] Expand the card's "Result" section and verify it shows the mock payload with `city`, `temperature: 68`, `humidity: 55`, `wind_speed: 10`, `conditions: "Sunny"`
- [ ] Verify NO custom-branded card appears (no `data-testid="custom-catchall-card"`, no `data-testid="weather-card"`)

#### `search_flights` renders via the SAME built-in default card

- [ ] Click the "Find flights" suggestion (or type "Find flights from SFO to JFK")
- [ ] Verify a tool-call card appears with tool name `search_flights`
- [ ] Verify the card has the identical visual style/structure as the `get_weather` card — same header layout, same status pill, same Arguments/Result sections
- [ ] Verify the Result section contains three mock flights (United UA231, Delta DL412, JetBlue B6722)

#### `roll_dice` renders via the SAME built-in default card

- [ ] Click the "Roll a d20" suggestion (or type "Roll a 20-sided die")
- [ ] Verify a tool-call card for `roll_dice` appears with the same default visual style
- [ ] Verify the Result section shows `{ "sides": 20, "result": <1-20> }`

#### `get_stock_price` renders via the SAME built-in default card

- [ ] Type "How is AAPL doing?"
- [ ] Verify a `get_stock_price` tool-call card appears with the default built-in style
- [ ] Verify the Result shows `ticker: "AAPL"`, a `price_usd`, and a `change_pct`

#### Chained tool calls

- [ ] Ask "What's the weather in Tokyo?" — the system prompt instructs the agent to chain tools
- [ ] Verify at least TWO default tool-call cards render in succession (e.g. `get_weather` then `search_flights`)
- [ ] Verify every card uses the identical default built-in UI — visually indistinguishable apart from the tool name and payload

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage
- [ ] Verify no unhandled-promise warnings when a tool call streams

## Expected Results

- Chat loads within 3 seconds
- Every tool invocation paints via the built-in `DefaultToolCallRenderer` card (tool name + live status pill + Arguments + Result)
- All four distinct tools (`get_weather`, `search_flights`, `get_stock_price`, `roll_dice`) render via the SAME default card — zero visual variance beyond payload
- No custom-branded renderer appears anywhere
- No UI errors or broken layouts
