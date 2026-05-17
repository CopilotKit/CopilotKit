# QA: Headless Chat (Complete) — LangGraph (Python)

## Prerequisites

- Demo is deployed and accessible at `/demos/headless-complete` on the dashboard host
- Agent backend is healthy (`/api/health`); `OPENAI_API_KEY` is set on Railway; `LANGGRAPH_DEPLOYMENT_URL` points at a LangGraph deployment exposing the `headless_complete` graph (backend tools: `get_weather`, `get_stock_price`)
- The demo wires `agent="headless-complete"` at `/api/copilotkit-mcp-apps` (shared with the mcp-apps cell) so the Excalidraw MCP server at `MCP_SERVER_URL || https://mcp.excalidraw.com` is available
- Note: the only `data-testid` in the source is `headless-complete-messages` on the scrollable messages container in `message-list.tsx`. Other checks rely on verbatim text, role selectors, and Tailwind utility classes

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/headless-complete`; verify the page renders within 3s with a centered card (max-width 3xl, full-height) on a `bg-gray-50` background
- [ ] Verify the custom header renders with `<h1>` text "Headless Chat (Complete)" and subtext "Built from scratch on useAgent — no CopilotChat."
- [ ] Verify the scrollable messages container (`[data-testid="headless-complete-messages"]`) is present and shows the empty-state hint "Try weather, a stock, a highlighted note, or an Excalidraw sketch."
- [ ] Verify the custom composer renders at the bottom: a `<textarea>` with placeholder "Type a message..." and a `<button type="submit">Send</button>` (disabled while textarea is empty)
- [ ] Confirm there is no `.copilotKitChat`, `.copilotKitMessages`, or `.copilotKitMessage` element in the DOM — the cell is truly headless and does NOT render `<CopilotChatMessageView>` or `<CopilotChatAssistantMessage>`

### 2. Feature-Specific Checks

#### Custom Composer + Send/Stop Toggle

- [ ] Type "Hello"; verify the Send button enables (goes from `bg-[#DBDBE5]` disabled to `bg-[#010507]` active)
- [ ] Press `Enter`; verify the message submits and the textarea clears; press `Shift+Enter` in a follow-up message and verify a newline is inserted without submitting
- [ ] While the agent is running, verify the textarea becomes disabled (`bg-[#FAFAFC]` muted), its placeholder switches to "Agent is working...", and the right-hand button swaps from "Send" to a red `bg-[#FA5F67]` "Stop" button
- [ ] Click "Stop" mid-stream; verify `copilotkit.stopAgent({ agent })` fires and the button reverts to "Send" once `isRunning` returns false

#### Message List + Bubbles (pure chrome)

- [ ] Send "Hello"; within 10s verify:
  - [ ] A user bubble renders right-aligned (`flex justify-end`), rounded with `rounded-2xl rounded-br-sm`, `bg-[#010507] text-white` at `max-w-[75%]`, text "Hello"
  - [ ] A typing indicator (small pulsing gray dot in a `bg-[#F0F0F4]` rounded bubble) appears while `isRunning` is true and BEFORE any assistant content has streamed
  - [ ] The assistant bubble renders left-aligned (`flex justify-start`), `rounded-2xl rounded-bl-sm`, `bg-[#F0F0F4] text-[#010507]` at `max-w-[85%]`, with the assistant's plain-text response inside a `whitespace-pre-wrap break-words` div
- [ ] Verify the messages container auto-scrolls to the bottom on each content-length change (send a long prompt whose response exceeds the viewport — scroll position should track the last line)
- [ ] Verify empty assistant messages (mid-stream before any text/tool call) do NOT flash an empty `bg-[#F0F0F4]` box — `AssistantBubble`'s `isEmpty` check suppresses them

#### Multi-Turn Conversation

- [ ] Send a second message ("What else can you do?"); verify the prior user+assistant pair remain in the transcript in chronological order and the new pair is appended below
- [ ] Verify each assistant bubble is independently sized (does not collapse neighbors) and the auto-scroll follows the newest content

#### Tool Rendering — WeatherCard (`useRenderTool` + backend `get_weather`)

- [ ] Send "What's the weather in Tokyo?"; within 15s verify a WeatherCard in the assistant bubble with eyebrow "FETCHING WEATHER" (loading) → "WEATHER" (complete), location "Tokyo" (`text-sm font-semibold capitalize`), temperature "68°", conditions "Sunny", wrapper `bg-[#EDEDF5] border-[#DBDBE5] rounded-xl max-w-xs`

#### Tool Rendering — StockCard (`useRenderTool` + backend `get_stock_price`)

- [ ] Send "What's AAPL trading at right now?"; within 15s verify a StockCard with eyebrow "LOADING" → "STOCK", ticker "AAPL" (`font-mono font-semibold`), price "$189.42", change "▲ 1.27%" in green `text-[#189370]`

#### Frontend Tool Rendering — HighlightNote (`useComponent` / `highlight_note`)

- [ ] Send "Highlight 'meeting at 3pm' in yellow."; within 15s verify a HighlightNote with eyebrow "NOTE", verbatim text "meeting at 3pm", and yellow variant classes `bg-[#FFF388]/30 border-[#FFF388]`
- [ ] Optionally request pink/green/blue and verify corresponding `COLOR_CLASSES` are applied

#### Wildcard Catch-all + MCP Apps Activity (`useDefaultRenderTool` + `useRenderActivityMessage`)

- [ ] Send "Use Excalidraw to sketch a simple system diagram."; within 30s verify:
  - [ ] The activity message renders inline as a sandboxed Excalidraw iframe (built-in `MCPAppsActivityRenderer`), proving the hand-rolled `useRenderActivityMessage` path in `use-rendered-messages.tsx`
  - [ ] Any ancillary tool-call (not `get_weather` / `get_stock_price` / `highlight_note`) gets a visible default card via `useDefaultRenderTool` — not silently dropped
  - [ ] DevTools → Console shows no errors referencing the MCP server URL

#### Reasoning + Suggestions

- [ ] If the agent emits any `role: "reasoning"` messages, verify each renders via the imported `CopilotChatReasoningMessage` leaf inside an assistant bubble (the only chat primitive imported in `use-rendered-messages.tsx`)
- [ ] Four suggestion strings are registered via `useConfigureSuggestions` with `available: "always"` ("Weather in Tokyo", "AAPL stock price", "Highlight a note", "Sketch a diagram") — exercised by manually sending the matching prompts above

### 3. Error Handling

- [ ] Attempt to submit an empty textarea; verify the Send button is disabled and Enter is a no-op (no user bubble, no run)
- [ ] While `isRunning` is true, verify additional keystrokes cannot trigger a second run (`handleSubmit`'s `if (!text || isRunning) return;` guard)
- [ ] Send a ~500-character message; verify the user bubble wraps within its 75% max-width via `break-words` without horizontal scroll
- [ ] Navigate away mid-run; verify the unmount cleanup (`ac.abort()` + `agent.detachActiveRun()`) does not produce an uncaught rejection in DevTools → Console (connect/run rejections are swallowed by design)
- [ ] With the backend stopped, send a message; verify `console.error("headless-complete: runAgent failed", err)` is emitted but no uncaught exception leaks, and the Send/Stop UI recovers to the idle state

## Expected Results

- Page loads within 3 seconds; first plain-text response within 10 seconds
- Tool renders (WeatherCard, StockCard, HighlightNote) surface within 15 seconds of the triggering prompt
- Excalidraw MCP activity surface renders within 30 seconds
- Full generative-UI weave is reconstructed without `<CopilotChatMessageView>` / `<CopilotChatAssistantMessage>`: assistant text + tool-call renders (per-tool + catch-all) + reasoning + activity messages all appear through the hand-rolled `useRenderedMessages` composition
- No flash of empty assistant bubbles while streaming; no uncaught console errors during any flow above
