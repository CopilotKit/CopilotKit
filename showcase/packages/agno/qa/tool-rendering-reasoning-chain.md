# QA: Tool Rendering (Reasoning Chain) — Agno

## Prerequisites

- Demo deployed at `/demos/tool-rendering-reasoning-chain`
- Agno reasoning agent served at `/reasoning/agui`, with `get_weather`,
  `search_flights`, `get_stock_price`, `roll_dice` tools available

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to `/demos/tool-rendering-reasoning-chain`
- [ ] Send "What's the weather in Tokyo?"
- [ ] Verify the custom amber reasoning card
      (`data-testid="reasoning-block"`) appears
- [ ] Verify the `WeatherCard` (`data-testid="weather-card"`) renders after
      the tool completes

### 2. Feature-Specific Checks

#### Catch-all renderer

- [ ] Send "Roll a 20-sided die"
- [ ] Verify the custom catch-all card
      (`data-testid="custom-catchall-card"` with `data-tool-name="roll_dice"`)
      renders with arguments and result

#### Flight chain

- [ ] Send "Find flights from SFO to JFK"
- [ ] Verify the `FlightListCard` (`data-testid="flight-list-card"`) renders
      with at least one flight row
- [ ] Verify origin / destination labels match the user's message

### 3. Error Handling

- [ ] No uncaught console errors
