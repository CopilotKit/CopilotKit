# QA: Headless Chat (Complete) — PydanticAI

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- `OPENAI_API_KEY` set

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/headless-complete`
- [ ] Verify the custom chat header "Headless Chat (Complete)" renders
- [ ] Verify the textarea input and Send button render
- [ ] Verify the empty-state hint is visible

### 2. Per-tool Renderers

- [ ] Click "Weather in Tokyo" suggestion. Verify a branded weather
      card renders inline in the assistant bubble with the temperature.
- [ ] Click "AAPL stock price" suggestion. Verify a branded stock card
      renders with ticker + price.
- [ ] Click "Highlight a note" suggestion. Verify a yellow highlight
      card renders in the chat (frontend-registered `useComponent`).

### 3. Streaming + Stop

- [ ] Send a message and verify the typing indicator shows while the
      agent is running
- [ ] While running, verify the Send button is replaced by a Stop button
- [ ] Click Stop mid-turn; verify the stream cancels

## Known Limitations

- The "Sketch a diagram" / Excalidraw-via-MCP suggestion is intentionally
  absent in the PydanticAI port — the package does not wire MCP Apps on
  the backend today (see `PARITY_NOTES.md`).

## Expected Results

- The fully headless chat (no `<CopilotChat />` / `<CopilotChatMessageView />`)
  still renders per-tool renderers, frontend-registered components, and
  the default catch-all via `useRenderToolCall`.
