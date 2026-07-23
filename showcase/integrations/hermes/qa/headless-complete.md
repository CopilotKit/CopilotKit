# QA: Headless Chat (Complete) — Hermes

## Prerequisites

- Demo is deployed and accessible at `/demos/headless-complete`
- The Hermes AG-UI adapter is healthy (single AG-UI endpoint on `:8000`); `AGENT_URL` points at it
- The demo wires `agent="headless-complete"` at `/api/copilotkit-mcp-apps` (shared with the mcp-apps cell) so the Excalidraw MCP server at `MCP_SERVER_URL || https://mcp.excalidraw.com` is available for the activity-render path
- The three data tools (`get_weather`, `get_stock_price`, `get_revenue_chart`) are CLIENT-executed frontend tools registered via `useFrontendTool` with deterministic fake-data handlers (Hermes has no backend tool execution); `highlight_note` is a `useComponent` frontend tool

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/headless-complete`; verify the page renders a centered card (max-width 3xl, full-height) on the `bg-background` surface
- [ ] Verify the custom header renders "Headless Chat" with subtext "Built without <CopilotChat> — full headless surface."
- [ ] Verify the empty state shows heading "The full headless surface" plus four clickable sample-prompt badges
- [ ] Verify the custom composer (`[data-testid="headless-composer"]`) renders at the bottom with a paperclip (attach), a textarea, and a send button
- [ ] Confirm there is no `.copilotKitChat` / `.copilotKitMessages` element — the cell is truly headless and does NOT render `<CopilotChat>`

### 2. Feature-Specific Checks

#### Suggestion pills (`useConfigureSuggestions` + `useSuggestions`)

- [ ] On first paint, the EmptyState shows four badges with `aria-label="Try suggestion: <text>"`
- [ ] After the first message, the SuggestionBar shows four badges with `aria-label="Suggestion: <title>"` (Weather / Stock price / Highlight a note / Revenue chart)

#### Tool Rendering — WeatherCard (`useFrontendTool` get_weather → render)

- [ ] Click the Weather pill (sends "What's the weather in Tokyo?"); within 15s verify a card (`[data-testid="headless-weather-card"]`) with location "Tokyo", conditions "Sunny", temperature "68°F"
- [ ] Verify the assistant bubble narration contains "Tokyo is 22°C and partly cloudy."

#### Tool Rendering — StockCard (`useFrontendTool` get_stock_price → render)

- [ ] Click the Stock price pill (sends "What's the price of AAPL right now?"); within 15s verify a card (`[data-testid="headless-stock-card"]`) with ticker "AAPL", price "$189.42", change "+1.27%"
- [ ] Verify the assistant bubble narration contains "AAPL is trading at $189.42, up 1.27% on the day"

#### Frontend Component — HighlightNote (`useComponent` / highlight_note)

- [ ] Click the Highlight a note pill (sends "Highlight this note for me: 'ship the demo on Friday'."); within 15s verify a card (`[data-testid="headless-highlight-card"]`) with the yellow variant and verbatim text "ship the demo on Friday"
- [ ] Verify the assistant bubble narration contains "ship the demo on Friday"

#### Tool Rendering — ChartCard (`useFrontendTool` get_revenue_chart → render)

- [ ] Click the Revenue chart pill (sends "Show me a chart of revenue over the last six months."); within 15s verify a card (`[data-testid="headless-revenue-chart"]`) titled "Quarterly revenue" with subtitle "Last six months · USD thousands" and month labels Jan…Jun
- [ ] Verify the assistant bubble narration contains "Here is the chart of revenue over the last six months"

#### Wildcard Catch-all + MCP Apps Activity (`useDefaultRenderTool` + `useRenderActivityMessage`)

- [ ] Ask the agent to "Use Excalidraw to sketch a simple system diagram."; verify the activity message renders inline as a sandboxed Excalidraw iframe (built-in `MCPAppsActivityRenderer`), proving the hand-rolled `useRenderActivityMessage` path in `chat/message-list.tsx`
- [ ] Any tool without a dedicated per-tool renderer surfaces via `useDefaultRenderTool` (GenericToolCard) rather than being silently dropped

#### Attachments (`useAttachments`)

- [ ] Click the paperclip and attach an image or PDF; verify an attachment chip renders in the composer, and after send it appears as a chip on the user bubble

### 3. Error Handling

- [ ] Attempt to submit an empty textarea with no attachment; verify the send button is disabled and Enter is a no-op
- [ ] While the agent is running, verify additional Enter keystrokes cannot trigger a second run (`sendText`'s `if (agent.isRunning) return;` guard) and the composer placeholder switches to "Agent is responding..."
- [ ] Click the header reset button mid-run; verify the run aborts and the transcript clears

## Expected Results

- Page loads within 3 seconds
- Tool renders (WeatherCard, StockCard, HighlightNote, ChartCard) surface within 15 seconds of the triggering pill
- Full generative-UI weave is reconstructed without `<CopilotChat>`: assistant text + tool-call renders (per-tool + catch-all) + activity messages all appear through the hand-rolled MessageList composition
- No flash of empty assistant bubbles while streaming; no uncaught console errors during any flow above

## D5 / aimock coverage

- Probe: `harness/src/probes/scripts/d5-gen-ui-headless-complete.ts` (featureType `gen-ui-headless-complete`, route `/demos/headless-complete`)
- Fixture: `aimock/d6/hermes/gen-ui-headless-complete.json` (context `hermes`); two-leg per tool (toolName-gated emit leg + toolCallId-gated narration leg, narration first)
