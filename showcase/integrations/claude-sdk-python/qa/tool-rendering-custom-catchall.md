# QA: Tool Rendering (Custom Catch-all) — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy
- ANTHROPIC_API_KEY is set

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/tool-rendering-custom-catchall`
- [ ] Verify the chat renders
- [ ] Click "Weather in SF" — verify the agent calls `get_weather`
- [ ] Verify the BRANDED `CustomCatchallRenderer` card appears (not the default)

### 2. Feature-Specific Checks

- [ ] Verify `data-testid="custom-catchall-card"` renders with the tool name
- [ ] Verify status pill transitions: streaming → running → done
- [ ] Try "Find flights" — verify the same branded card renders

### 3. Error Handling

- [ ] Verify no console errors

## Expected Results

- Every tool call renders via the custom `CustomCatchallRenderer`, including tool name, arguments pre, and result pre
