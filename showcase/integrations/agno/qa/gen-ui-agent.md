# QA: Agentic Generative UI — Agno

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the gen-ui-agent demo page
- [ ] Verify the chat interface loads in a centered full-height layout
- [ ] Verify the chat input placeholder "Type a message" is visible
- [ ] Send a basic message
- [ ] Verify the agent responds

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Simple plan" suggestion button is visible (plan to go to Mars in 5 steps)
- [ ] Verify "Complex plan" suggestion button is visible (plan to make pizza in 10 steps)

#### Task Progress Tracker (useAgent with state streaming)

- [ ] Click "Simple plan" suggestion or type "Build a plan to go to Mars in 5 steps"
- [ ] Verify the TaskProgress component renders (`data-testid="task-progress"`)
- [ ] Verify the progress bar appears with a gradient fill
- [ ] Verify step items appear with descriptions (`data-testid="task-step-text"`)
- [ ] Verify the "N/N Complete" counter updates as steps complete
- [ ] Verify completed steps show:
  - Green background gradient
  - Check icon
  - Green text color
- [ ] Verify the current pending step shows:
  - Blue/purple background gradient
  - Spinner icon with "Processing..." text
  - Pulsing animation
- [ ] Verify future pending steps show:
  - Gray background
  - Clock icon
  - Muted text color

#### Complex Plan

- [ ] Type "Plan to make pizza in 10 steps"
- [ ] Verify 10 steps appear in the progress tracker
- [ ] Verify progress bar width increases as steps complete

### 3. Error Handling

- [ ] Send an empty message (should be handled gracefully)
- [ ] Verify no console errors during normal usage

## Expected Results

- Chat loads within 3 seconds
- Agent responds within 10 seconds
- Task progress tracker shows live step completion
- Progress bar animates smoothly
- No UI errors or broken layouts
