# QA: Agentic Chat — AWS Strands

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the agentic-chat demo page
- [ ] Verify the chat interface loads with a text input placeholder "Type a message"
- [ ] Verify the background container (`data-testid="background-container"`) is visible
- [ ] Verify the default background color is the theme default (rgb(250, 250, 249))
- [ ] Send a basic message (e.g. "Hello")
- [ ] Verify the agent responds with a text message

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Change background" suggestion button is visible
- [ ] Verify "Generate sonnet" suggestion button is visible
- [ ] Click the "Change background" suggestion
- [ ] Verify the suggestion either populates the input or sends the message

#### Background Change (useFrontendTool)

- [ ] Ask "Change the background to a sunset gradient"
- [ ] Verify the background container style changes from the default
- [ ] Verify the change_background tool returns a success status

#### Weather Render Tool (useRenderTool)

- [ ] Type "What's the weather in Tokyo?"
- [ ] Verify loading state shows "Loading weather..." (`data-testid="weather-info-loading"`)
- [ ] Verify WeatherCard renders (`data-testid="weather-info"`) with:
  - [ ] City name displayed
  - [ ] Temperature in degrees C
  - [ ] Humidity percentage
  - [ ] Wind speed in mph
  - [ ] Conditions text

#### Agent Context

- [ ] Verify the agent knows the user's name is "Bob" (provided via useAgentContext)
- [ ] Ask "What is my name?" and verify the agent responds with "Bob"

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage
- [ ] Send a very long message and verify no UI breakage

## Expected Results

- Chat loads within 3 seconds
- Agent responds within 10 seconds
- Background changes are instant after tool execution
- Weather card renders with all data fields populated
- No UI errors or broken layouts
