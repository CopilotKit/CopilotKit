# QA: Headless Chat (Complete) — Langroid

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/headless-complete`
- [ ] Verify the page loads without `<CopilotChat />` — a hand-rolled message list + input
- [ ] Verify the input is focused and enabled
- [ ] Send a message and verify an assistant response bubble renders
- [ ] Verify a typing indicator appears while the agent is running

### 2. Tool Rendering

- [ ] Click the "Weather in Tokyo" suggestion
- [ ] Verify a branded WeatherCard appears inline in the message list
- [ ] Verify tool-call renderers (useRenderTool, useDefaultRenderTool) paint
      without the built-in CopilotChat chrome
