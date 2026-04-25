# QA: Headless Chat (Complete) — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy
- ANTHROPIC_API_KEY is set

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/headless-complete`
- [ ] Verify the custom chat surface renders (header, scrollable list, input bar)
- [ ] Verify NO `<CopilotChat />` imports are visible (all chrome is custom)
- [ ] Send "Hello" — verify the user bubble + assistant bubble render

### 2. Generative UI Weave

- [ ] Click the "Weather in Tokyo" suggestion — verify the WeatherCard renders inline
- [ ] Click the "Highlight a note" suggestion — verify the HighlightNote component renders
- [ ] Try a message that triggers other tools — verify the catch-all tool card renders

### 3. Lifecycle

- [ ] During agent response, verify the Send button swaps to Stop
- [ ] Click Stop — verify the agent cancels cleanly
- [ ] Verify no console errors after stop

## Expected Results

- Messages area with `data-testid="headless-complete-messages"` scrolls automatically
- Input disabled while running; Send button disabled when empty
