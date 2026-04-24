# QA: Tool Rendering (Custom Catch-all) — Langroid

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- Agent slug `tool-rendering-custom-catchall` is registered at `/api/copilotkit`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the `tool-rendering-custom-catchall` demo page
- [ ] Verify the chat interface loads in a centered full-height layout

### 2. Feature-Specific Checks — Custom Wildcard Renderer

The page registers a single branded wildcard via `useDefaultRenderTool`
with a custom `render` function (`CustomCatchallRenderer`). Every tool
call paints through that same branded card.

- [ ] Click "Weather in SF"
- [ ] Verify a card with `data-testid="custom-catchall-card"` appears
- [ ] Verify `data-testid="custom-catchall-tool-name"` reads `get_weather`
- [ ] Verify `data-testid="custom-catchall-status"` transitions through
      `streaming` / `running` and lands on `done`
- [ ] Expand Arguments and verify the args JSON is visible
- [ ] Expand Result and verify the mock weather payload is visible
- [ ] Verify NO built-in default card shows for this tool

### 3. Expected

- Every tool paints through the same branded card
- No per-tool renderers
- Status badge matches tool lifecycle
