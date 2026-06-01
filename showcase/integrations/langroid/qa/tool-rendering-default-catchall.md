# QA: Tool Rendering (Default Catch-all) — Langroid

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)
- Agent slug `tool-rendering-default-catchall` is registered at `/api/copilotkit`

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the `tool-rendering-default-catchall` demo page
- [ ] Verify the chat interface loads in a centered full-height layout (max-width 4xl, `rounded-2xl`)
- [ ] Verify the chat input placeholder "Type a message" is visible
- [ ] Send a basic message and verify the Langroid agent responds

### 2. Feature-Specific Checks — Built-in Default Tool-Call UI

The page calls `useDefaultRenderTool()` with NO config, so every tool
call routes to CopilotKit's built-in `DefaultToolCallRenderer`.

#### Suggestions

- [ ] Verify "Weather in SF" suggestion pill is visible
- [ ] Verify "Find flights" suggestion pill is visible
- [ ] Verify "Weather in Tokyo" suggestion pill is visible

#### get_weather renders via the built-in default card

- [ ] Click "Weather in SF"
- [ ] Verify a default tool-call card appears with `get_weather` as header
- [ ] Verify status transitions `Running -> Done`
- [ ] Verify no `data-testid="custom-catchall-card"` and no
      `data-testid="weather-card"` — only the built-in card paints.

#### search_flights renders via the same built-in card

- [ ] Click "Find flights"
- [ ] Verify a second default card with `search_flights` header
- [ ] Verify status lands on `Done`

### 3. Expected

- No per-tool branded cards
- No custom wildcard renderer
- Every tool call uses the package-provided default card
