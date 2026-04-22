# QA: Tool-Based Generative UI — Claude Agent SDK (Python)

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the gen-ui-tool-based demo page
- [ ] Verify the CopilotSidebar opens by default with title "Haiku Generator"
- [ ] Verify a placeholder haiku card is displayed on the main area
- [ ] Send a basic message via the sidebar
- [ ] Verify the agent responds

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Nature Haiku" suggestion button is visible
- [ ] Verify "Ocean Haiku" suggestion button is visible
- [ ] Verify "Spring Haiku" suggestion button is visible

#### Haiku Generation (useFrontendTool)

- [ ] Click the "Nature Haiku" suggestion or type "Write me a haiku about nature"
- [ ] Verify a HaikuCard renders (`data-testid="haiku-card"`) with:
  - [ ] Three Japanese text lines (`data-testid="haiku-japanese-line"`)
  - [ ] Three English translation lines (`data-testid="haiku-english-line"`)
  - [ ] A background gradient style applied to the card
- [ ] Verify the Japanese text contains actual Japanese characters (not Latin)
- [ ] Verify the English lines are a readable English translation

#### Image Display

- [ ] After haiku generation, verify an image renders (`data-testid="haiku-image"`) if the agent provides an image_name
- [ ] Verify the image src points to /images/ with a valid filename from the predefined list

#### Multiple Haikus

- [ ] Generate a second haiku (e.g. "Ocean Haiku")
- [ ] Verify the new haiku card appears at the top
- [ ] Verify the previous haiku card is still visible below
- [ ] Verify the initial placeholder haiku is removed

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results

- Sidebar loads within 3 seconds
- Agent responds and generates haiku within 10 seconds
- Haiku cards display with Japanese and English text
- Generated haikus stack with newest on top
- No UI errors or broken layouts
