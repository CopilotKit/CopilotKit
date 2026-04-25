# QA: Tool Rendering (Custom Catch-all) — Agno

## Prerequisites

- Demo deployed at `/demos/tool-rendering-custom-catchall`
- Agent backend healthy

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/tool-rendering-custom-catchall`
- [ ] Verify chat renders with suggestion pills

### 2. Feature-Specific Checks

- [ ] Click "Weather in SF"
- [ ] Verify a `data-testid="custom-catchall-card"` renders (branded catch-all UI)
- [ ] Verify `data-testid="custom-catchall-tool-name"` shows `get_weather`
- [ ] Verify `data-testid="custom-catchall-status"` eventually shows "done"
- [ ] Verify `data-testid="custom-catchall-args"` and `data-testid="custom-catchall-result"` render

### 3. Error Handling

- [ ] No uncaught console errors
