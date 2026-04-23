# QA: Tool Rendering — MS Agent Framework (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the tool-rendering demo page
- [ ] Verify the chat interface loads in a centered full-height layout
- [ ] Verify the chat input placeholder "Type a message" is visible
- [ ] Send a basic message
- [ ] Verify the agent responds

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Weather in San Francisco" suggestion button is visible
- [ ] Verify "Weather in New York" suggestion button is visible
- [ ] Verify "Weather in Tokyo" suggestion button is visible
- [ ] Click a weather suggestion and verify it populates the input or sends the message

#### Weather Card Rendering (useRenderTool)

- [ ] Type "What's the weather in San Francisco?"
- [ ] Verify loading state shows "Retrieving weather..." with a spinner
- [ ] Verify the WeatherCard renders (`data-testid="weather-card"`) with:
  - [ ] City name displayed (`data-testid="weather-city"`)
  - [ ] Temperature in both Celsius and Fahrenheit
  - [ ] Humidity percentage (`data-testid="weather-humidity"`)
  - [ ] Wind speed in mph (`data-testid="weather-wind"`)
  - [ ] Feels-like temperature (`data-testid="weather-feels-like"`)
  - [ ] Conditions text with appropriate weather icon (sun/rain/cloud)
- [ ] Verify the card background color matches the weather condition theme:
  - Clear/Sunny: #667eea (blue-purple)
  - Rain/Storm: #4A5568 (dark gray)
  - Cloudy: #718096 (medium gray)
  - Snow: #63B3ED (light blue)

#### Multiple Weather Queries

- [ ] Ask about weather in a second city
- [ ] Verify a second WeatherCard renders without breaking the first
- [ ] Verify each card shows the correct city name

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results

- Chat loads within 3 seconds
- Agent responds within 10 seconds
- Weather cards render with all data fields populated
- Weather icon and theme color match the conditions
- No UI errors or broken layouts
