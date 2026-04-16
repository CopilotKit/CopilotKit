# QA: Agentic Generative UI — LlamaIndex

## Prerequisites

- Demo is deployed and accessible
- Agent backend is healthy (check /api/health)

## Test Steps

### 1. Basic Functionality

- [ ] Navigate to the gen-ui-agent demo page
- [ ] Verify the chat interface loads in a centered full-height layout
- [ ] Verify the chat input placeholder "Type a message" is visible
- [ ] Verify the custom message list container renders (`data-testid="copilot-message-list"`)
- [ ] Send a basic message (e.g. "Hello")
- [ ] Verify the agent responds

### 2. Feature-Specific Checks

#### Suggestions

- [ ] Verify "Simple plan" suggestion button is visible (plan to go to mars in 5 steps)
- [ ] Verify "Complex plan" suggestion button is visible (plan to make pizza in 10 steps)

#### Task Progress Tracker (useAgent with state streaming)

- [ ] Click "Simple plan" suggestion or type "Please build a plan to go to mars in 5 steps."
- [ ] Verify the TaskProgress component renders (`data-testid="task-progress"`)
- [ ] Verify the "Task Progress" heading is visible with gradient text styling
- [ ] Verify the progress bar appears with a blue-to-purple gradient fill
- [ ] Verify the "N/N Complete" counter is displayed and updates as steps complete
- [ ] Verify step items appear with descriptions (`data-testid="task-step-text"`)
- [ ] Verify completed steps show:
  - Green gradient background (from-green-50 to-emerald-50)
  - Check icon in a green gradient circle
  - Green text color (text-green-700)
- [ ] Verify the current pending step shows:
  - Blue/purple gradient background (from-blue-50 to-purple-50)
  - Spinner icon with "Processing..." text
  - Pulsing animation overlay
- [ ] Verify future pending steps show:
  - Gray background (bg-gray-50/50)
  - Clock icon
  - Muted text color (text-gray-500)

#### Complex Plan

- [ ] Click "Complex plan" suggestion or type "Please build a plan to make pizza in 10 steps."
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
