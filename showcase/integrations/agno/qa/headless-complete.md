# QA: Headless Chat (Complete) — Agno

## Prerequisites

- Demo deployed at `/demos/headless-complete`
- Agno main agent backend healthy (served at `/agui`)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/headless-complete`
- [ ] Verify the custom chrome renders — header, scrollable messages area
      (`data-testid="headless-complete-messages"`), input bar
- [ ] Verify empty-state hint: "Try weather, a stock, or a highlighted note."

### 2. Feature-Specific Checks

#### Weather card via backend tool

- [ ] Send "What's the weather in Tokyo?"
- [ ] Verify a compact `WeatherCard` renders inside an assistant bubble
- [ ] Verify the typing indicator shows while the agent is running

#### Stock card via backend tool

- [ ] Send "AAPL stock price"
- [ ] Verify a compact `StockCard` renders with ticker, price, delta

#### Highlight note via frontend tool (useComponent)

- [ ] Send "Highlight 'meeting at 3pm' in yellow"
- [ ] Verify a yellow `HighlightNote` card renders inline

#### Stop button

- [ ] Send a long-running prompt
- [ ] Verify the Stop button appears while the agent is running
- [ ] Click Stop and verify the agent halts

### 3. Error Handling

- [ ] No uncaught console errors
