# QA: Tool Rendering (Default Catch-all) — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy
- ANTHROPIC_API_KEY is set

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/tool-rendering-default-catchall`
- [ ] Verify the chat renders
- [ ] Click "Weather in SF" — verify the agent calls `get_weather`
- [ ] Verify the BUILT-IN `DefaultToolCallRenderer` card appears inline

### 2. Feature-Specific Checks

- [ ] Verify the tool-call card shows the tool name, status pill (Running → Done), and Arguments/Result sections
- [ ] Try "Find flights" — verify multiple tool calls render

### 3. Error Handling

- [ ] Verify no console errors during tool calls

## Expected Results

- CopilotKit's package-provided default tool card renders every tool call (no custom renderers)
