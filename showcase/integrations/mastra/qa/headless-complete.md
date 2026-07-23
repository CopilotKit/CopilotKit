# QA: Headless Chat (Complete) — Mastra

## Test Steps

- [ ] Navigate to `/demos/headless-complete`
- [ ] Verify the custom headless chat renders (custom bubbles + input bar, no `<CopilotChat />`)
- [ ] Type "What's the weather in Tokyo?" and press Enter
- [ ] Verify a WeatherCard renders inline with city/temperature/conditions
- [ ] Type "What's AAPL trading at right now?"
- [ ] Verify a StockCard renders with ticker + price + % change
- [ ] Type "Highlight 'meeting at 3pm' in yellow."
- [ ] Verify a yellow HighlightNote renders inline (frontend-registered tool)
- [ ] Verify Stop button appears while the agent is running and cancels the turn

## Expected Results

- Full generative-UI weave composed manually via `useRenderToolCall`, `useRenderActivityMessage`, `useRenderCustomMessages`
- Weather + stock tool renderers wired via `useRenderTool`
- `highlight_note` registered on the frontend via `useComponent`
- Wildcard catch-all renders any other tool call via `useDefaultRenderTool`

## Known Limitations

- The langgraph-python reference wires in Excalidraw MCP tools via `/api/copilotkit-mcp-apps`. Mastra skips mcp-apps as a truthful architectural limitation (see `PARITY_NOTES.md`), so the "Sketch a diagram" suggestion is omitted.
