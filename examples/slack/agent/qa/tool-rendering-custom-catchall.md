# QA: Tool Rendering (Custom Catch-all) — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- Agent slug `tool-rendering-custom-catchall` is registered at `/api/copilotkit`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the `tool-rendering-custom-catchall` demo page
- [ ] Verify the chat interface loads in a centered full-height layout (max-width 4xl, `rounded-2xl`)
- [ ] Verify the chat input placeholder "Type a message" is visible
- [ ] Send a basic message (e.g. "Hi")
- [ ] Verify the agent responds with a text message

### 2. Feature-Specific Checks — Branded Wildcard Renderer

The frontend calls `useDefaultRenderTool({ render: ... })` with a SINGLE branded wildcard component (`CustomCatchallRenderer`). There are ZERO per-tool named renderers. Every tool call must paint via this one branded card regardless of tool identity.

#### Suggestions

- [ ] Verify "Weather in SF" suggestion pill is visible
- [ ] Verify "Find flights" suggestion pill is visible
- [ ] Verify "Roll a d20" suggestion pill is visible
- [ ] Click a suggestion and verify it either populates the input or sends the message

#### `get_weather` renders via the branded catch-all card

- [ ] Click the "Weather in SF" suggestion (or type "What's the weather in San Francisco?")
- [ ] Verify the branded card renders (`data-testid="custom-catchall-card"`) with:
  - [ ] An uppercase label "Tool" followed by the tool name `get_weather` (`data-testid="custom-catchall-tool-name"`, monospaced)
  - [ ] The card root carries `data-tool-name="get_weather"`
  - [ ] A status badge (`data-testid="custom-catchall-status"`) that transitions through `streaming` (amber), `running` (lavender/indigo), and finally `done` (green `#189370`)
  - [ ] An "Arguments" section with a monospaced pre block (`data-testid="custom-catchall-args"`) showing pretty-printed JSON of the parameters
  - [ ] A "Result" section showing "waiting for tool to finish…" while pending and a green-tinted pre block (`data-testid="custom-catchall-result"`) once `status === "complete"`
  - [ ] The completed Result pre shows the mock weather payload (`city`, `temperature: 68`, `humidity: 55`, `wind_speed: 10`, `conditions: "Sunny"`)
- [ ] Verify the card uses the branded styling: white background, rounded `2xl` corners, `#DBDBE5` border, `#FAFAFC` header strip, subtle shadow

#### `search_flights` renders via the SAME branded catch-all card

- [ ] Click the "Find flights" suggestion (or type "Find flights from SFO to JFK")
- [ ] Verify a second `data-testid="custom-catchall-card"` renders
- [ ] Verify `data-tool-name="search_flights"` on the card root and the name label reads `search_flights`
- [ ] Verify the visual style is IDENTICAL to the `get_weather` card — same header strip, same status badge treatment, same Arguments/Result sections
- [ ] Verify the Result pre shows the mock flights array (United UA231, Delta DL412, JetBlue B6722)

#### `roll_dice` renders via the SAME branded catch-all card

- [ ] Click the "Roll a d20" suggestion (or type "Roll a 20-sided die")
- [ ] Verify another `custom-catchall-card` renders with `data-tool-name="roll_dice"`
- [ ] Verify the Result pre shows `{ "sides": 20, "result": <1-20> }`

#### `get_stock_price` renders via the SAME branded catch-all card

- [ ] Type "How is AAPL doing?"
- [ ] Verify a `custom-catchall-card` with `data-tool-name="get_stock_price"` renders
- [ ] Verify the Result pre shows `ticker: "AAPL"`, a `price_usd`, and a `change_pct`

#### No built-in default UI appears

- [ ] Verify NO instance of CopilotKit's built-in `DefaultToolCallRenderer` appears alongside the branded card — the branded card replaces it
- [ ] Verify every rendered tool call is a `data-testid="custom-catchall-card"` element

#### Chained tool calls all paint the same branded card

- [ ] Ask "What's the weather in Tokyo?" — the system prompt instructs the agent to chain tools
- [ ] Verify at least TWO `custom-catchall-card` elements render in succession (e.g. one for `get_weather`, one for `search_flights`)
- [ ] Verify each carries a distinct `data-tool-name` but the visual style is identical
- [ ] While a tool is in flight, verify the status badge reads `streaming` or `running` and the Result section shows "waiting for tool to finish…"; after completion the badge reads `done` and the green Result pre appears

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage
- [ ] Verify the `done` badge text and the completed-result green tint (`#85ECCE`) remain stable across re-renders

## Expected Results

- Chat loads within 3 seconds
- Every tool invocation paints via the single branded `CustomCatchallRenderer` card — zero visual variance beyond `data-tool-name` and the payload
- Status badge progresses: `streaming` → `running` → `done`
- Branded styling details from `custom-catchall-renderer.tsx` are visible (uppercase "Tool" label, monospaced tool-name, rounded-2xl card, header strip, tone-coded status badge, green result pre on completion)
- No UI errors or broken layouts
