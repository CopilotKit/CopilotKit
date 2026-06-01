# QA: Tool Rendering + Reasoning Chain — LlamaIndex

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the tool-rendering-reasoning-chain demo page
- [ ] Verify the chat interface loads with placeholder "Type a message"

### 2. Reasoning Slot

- [ ] Ask a question such as "What's the weather in Tokyo and any flights from SFO?"
- [ ] Verify the custom reasoning block (`data-testid="reasoning-block"`) is
      visible while the agent is thinking

### 3. Tool Renderers

- [ ] Weather tool: ask "What's the weather in Tokyo?"
  - [ ] `data-testid="weather-card"` is visible
  - [ ] City name matches the request
- [ ] Flights tool: ask "Find flights from SFO to JFK"
  - [ ] `data-testid="flight-list-card"` is visible
  - [ ] Origin and destination match the request
- [ ] Catch-all tool: ask "Roll a 20-sided die for me"
  - [ ] `data-testid="custom-catchall-card"` is visible
  - [ ] Status badge cycles through streaming → running → done
